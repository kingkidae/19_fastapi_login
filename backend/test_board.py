# 게시판 CRUD·댓글·좋아요·첨부파일 확인용: `uv run python test_board.py`
# DB는 메모리 SQLite, 로그인 사용자는 가짜라 실제 Supabase 데이터를 건드리지 않음
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
import main

engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
event.listen(engine, "connect", lambda conn, _: conn.execute("pragma foreign_keys=on"))  # 삭제 연쇄(CASCADE) 확인용
main.Base.metadata.create_all(engine)
with Session(engine) as db:
    db.add_all([main.Profile(id="u1", username="개미1"), main.Profile(id="u2", username="개미2")])
    db.commit()

me = {"id": "u1"}
main.app.dependency_overrides[main.get_db] = lambda: Session(engine)
main.app.dependency_overrides[main.current_profile] = lambda: Session(engine).get(main.Profile, me["id"])
main.app.dependency_overrides[main.viewer_id] = lambda: me["id"]
storage_calls = []  # 실제 Supabase Storage 대신 호출 기록만
main.storage_request = lambda method, path, token, **kw: storage_calls.append((method, path, kw.get("json")))
c = TestClient(main.app, headers={"Authorization": "Bearer test"})

# 작성 + 입력 검사
post = {"board": "국산차", "car": "아반떼", "title": "  연비 실화냐  ", "content": "시내 15km 나옴"}
pid = c.post("/posts", json=post).json()["id"]
assert c.post("/posts", json={**post, "title": "   "}).status_code == 422  # 공백 제목 거절
assert c.post("/posts", json={**post, "board": "비행기"}).status_code == 422  # 없는 토론방 거절

# 읽기: 공백 제거, 조회수 증가
r = c.get(f"/posts/{pid}").json()
assert (r["title"], r["author"], r["views"], r["liked"]) == ("연비 실화냐", "개미1", 1, False), r
assert c.get(f"/posts/{pid}").json()["views"] == 2

# 좋아요 토글 + 목록 집계
assert c.post(f"/posts/{pid}/like").json() == {"liked": True, "likes": 1}
c.post(f"/posts/{pid}/comments", json={"content": "동의"})
row = c.get("/posts?board=국산차").json()[0]
assert (row["likes"], row["comments"]) == (1, 1), row
assert c.post(f"/posts/{pid}/like").json() == {"liked": False, "likes": 0}
assert c.get("/cars/trending").json() == [{"car": "아반떼", "posts": 1}]

# 남의 글/댓글은 수정·삭제 불가
me["id"] = "u2"
assert c.put(f"/posts/{pid}", json=post).status_code == 403
assert c.delete(f"/posts/{pid}").status_code == 403
cid = c.get(f"/posts/{pid}").json()["comment_list"][0]["id"]
assert c.delete(f"/comments/{cid}").status_code == 403

# 첨부파일: 형식·크기·개수 검사, 남의 글엔 못 올림
me["id"] = "u1"
png = ("a.png", b"PNG fake", "image/png")
r = c.post(f"/posts/{pid}/attachments", files={"file": png})
assert r.status_code == 201 and r.json()["url"].endswith(".png"), r.text
assert storage_calls[-1][0] == "POST" and storage_calls[-1][1].startswith(f"attachments/{pid}/")
assert c.post(f"/posts/{pid}/attachments", files={"file": ("x.html", b"<script>", "text/html")}).status_code == 415
assert c.post(f"/posts/{pid}/attachments", files={"file": ("big.png", b"0" * (5 * 1024 * 1024 + 1), "image/png")}).status_code == 413
for _ in range(4):
    c.post(f"/posts/{pid}/attachments", files={"file": png})
assert c.post(f"/posts/{pid}/attachments", files={"file": png}).status_code == 400  # 6번째
att = c.get(f"/posts/{pid}").json()["attachments"]
assert len(att) == 5 and att[0]["name"] == "a.png"
main.STORAGE_BUDGET, budget = 10, main.STORAGE_BUDGET  # 용량 한도 넘으면 거절
assert c.delete(f"/attachments/{att[4]['id']}").status_code == 204
assert c.post(f"/posts/{pid}/attachments", files={"file": png}).status_code == 507
main.STORAGE_BUDGET = budget
me["id"] = "u2"
assert c.post(f"/posts/{pid}/attachments", files={"file": png}).status_code == 403
assert c.delete(f"/attachments/{att[0]['id']}").status_code == 403

# 내 글 수정 → 삭제하면 댓글도 같이 삭제, Storage 파일도 삭제 요청
me["id"] = "u1"
assert c.put(f"/posts/{pid}", json={**post, "title": "수정됨"}).status_code == 200
assert c.get(f"/posts/{pid}").json()["title"] == "수정됨"
assert c.delete(f"/posts/{pid}").status_code == 204
assert storage_calls[-1][0] == "DELETE" and len(storage_calls[-1][2]["prefixes"]) == 4
assert c.get(f"/posts/{pid}").status_code == 404
with Session(engine) as db:
    assert db.query(main.Comment).count() == 0 and db.query(main.Attachment).count() == 0

print("ok")
