# 소셜 로그인 콜백 확인용: `uv run python test_callback.py`
# Supabase 응답은 가짜, DB는 메모리 SQLite라 실제 계정/DB를 건드리지 않음
from types import SimpleNamespace
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
import main

engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
main.Base.metadata.create_all(engine)
main.app.dependency_overrides[main.get_db] = lambda: Session(engine)
client = TestClient(main.app, follow_redirects=False)


def fake_exchange(user_id, name, email=None):
    user = SimpleNamespace(id=user_id, email=email, app_metadata={"provider": "kakao"}, user_metadata={"name": name})
    def exchange(params):
        assert params["code_verifier"] == "my-verifier"  # 이 브라우저 쿠키의 값으로 교환해야 함
        return SimpleNamespace(user=user, session=SimpleNamespace(access_token=f"tok-{user_id}"))
    main.supabase.auth.exchange_code_for_session = exchange
    # 로그인 시작 때 받은 쿠키 (콜백이 한 번 쓰고 지우므로 매번 새로)
    client.cookies.set("pkce", "my-verifier", domain="testserver.local", path="/auth/callback")


# 0) 로그인 시작 -> 검증값을 HttpOnly 쿠키로 브라우저에 묶음
r = client.get("/login/kakao")
assert r.status_code == 307 and "kakao" in r.headers["location"]
assert "pkce=" in r.headers["set-cookie"] and "HttpOnly" in r.headers["set-cookie"], r.headers["set-cookie"]
client.cookies.clear()

# 0-1) 쿠키 없는 브라우저(다른 사람이 보낸 콜백 링크) -> 교환 시도 없이 거절
fake_exchange("cccccccc-0000", "공격자")
client.cookies.clear()
assert client.get("/auth/callback?code=x").headers["location"] == "http://localhost:5173/login?error=social"


# 1) 이메일 없는 카카오 사용자 -> 프로필 저장, 메인(/#token)으로 이동
fake_exchange("aaaaaaaa-1111", "홍길동")
r = client.get("/auth/callback?code=x")
assert r.status_code == 307 and r.headers["location"] == "http://localhost:5173/#token=tok-aaaaaaaa-1111", r.headers
assert 'pkce=""' in r.headers["set-cookie"]  # 한 번 쓰고 삭제
p = Session(engine).get(main.Profile, "aaaaaaaa-1111")
assert (p.username, p.email, p.provider) == ("홍길동", None, "kakao")

# 2) 같은 닉네임의 다른 사용자 -> 500 대신 id 앞 6자리를 붙여 저장
fake_exchange("bbbbbbbb-2222", "홍길동")
assert client.get("/auth/callback?code=x").status_code == 307
assert Session(engine).get(main.Profile, "bbbbbbbb-2222").username == "홍길동_bbbbbb"

# 3) 다시 로그인한 기존 사용자 -> 중복 저장 없이 통과
fake_exchange("aaaaaaaa-1111", "홍길동")
assert client.get("/auth/callback?code=x").status_code == 307
assert Session(engine).query(main.Profile).count() == 2

# 4) 동의 취소 등으로 code 없음 -> 프론트에 에러 표시
assert client.get("/auth/callback?error=access_denied").headers["location"] == "http://localhost:5173/login?error=social"

print("ok")
