import os
import re
import uuid
from urllib.parse import urlparse
from typing import Annotated, Literal
import httpx
from fastapi import FastAPI, Depends,HTTPException, Cookie, Query, UploadFile
from sqlalchemy import create_engine, Column, Integer, String, Text, DateTime, ForeignKey, func, select, update, text # sqlalchemy는 db를 다루는 라이브러리로 유효성을 검사함.
from sqlalchemy.orm import declarative_base, Session
from pydantic import BaseModel, StringConstraints #사용 전에 유용한지 아닌지 여부 확인하는 라이브러리
from supabase import create_client,ClientOptions
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.responses import RedirectResponse
from supabase_auth.errors import AuthApiError, AuthError
from mangum import Mangum

# 비밀값과 주소는 환경변수에서 읽음 (로컬: backend/.env, 배포: Lambda 환경변수). 실행: uv run --env-file .env ...
FRONTEND_URL = os.environ["FRONTEND_URL"]
API_URL = os.environ["API_URL"]  # 브라우저가 보는 백엔드 주소. 소셜 로그인 콜백이 여기로 돌아옴
CALLBACK_PATH = urlparse(API_URL).path + "/auth/callback"

DATABASE_URL = os.environ["DATABASE_URL"]
# 슈파베이스 프로젝트 오버뷰 해서 커넥트 누르고, 다이렉트 커넥트, 세션풀러 선택해서 스크롤 내리면 커넥트 스트링 옆에 쉐어드풀러 에 있는 링크입력하면 됨. 링크 내 [유어 패스워드]비번은 프로젝트 생성할 때 정한 비번치면 됨. 대괄호까지 없애줘야 함.
# 비번 까먹었을 때 슈파베이스 - 데이터베이스 - 세팅즈 - 리셋 패스워드눌리면 재설정 가능함. DB같은 경우는 평소쓰던 비번 쓰면 리스키하기 때문에 비번 재생성 만드는 창에서 제너레이트 패스워드하면 어려운 비번 알아서 세팅해줌.
engine = create_engine(DATABASE_URL, pool_pre_ping=True)  # Lambda가 쉬는 동안 끊긴 연결을 다시 맺음
Base = declarative_base()

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]
supabase = create_client(SUPABASE_URL, SUPABASE_KEY,options=ClientOptions(flow_type="pkce"))

#table model 생성 (table name: users) 클래스는 객체를 만들어주는 명령어임.
class Profile(Base): #테이블을 정의함. 슈파베이스 들어가보면 users라는 테이블이 있음.
    __tablename__ = "profiles"
    id = Column(String(50), primary_key = True, index = True)
    username = Column(String(50), unique = True, index = True)
    email = Column(String(120))
    provider = Column(String(50))

#자동차 토론 게시판 테이블: 글, 댓글, 좋아요(사람당 1번), 첨부파일
class Post(Base):
    __tablename__ = "posts"
    id = Column(Integer, primary_key=True)
    author_id = Column(String(50), ForeignKey("profiles.id", ondelete="CASCADE"), nullable=False, index=True)
    board = Column(String(20), nullable=False, index=True)
    car = Column(String(40), index=True)  # 차종 (선택)
    title = Column(String(100), nullable=False)
    content = Column(Text, nullable=False)
    views = Column(Integer, nullable=False, server_default="0")
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), index=True)
    updated_at = Column(DateTime(timezone=True))

class Comment(Base):
    __tablename__ = "comments"
    id = Column(Integer, primary_key=True)
    post_id = Column(Integer, ForeignKey("posts.id", ondelete="CASCADE"), nullable=False, index=True)
    author_id = Column(String(50), ForeignKey("profiles.id", ondelete="CASCADE"), nullable=False)
    content = Column(String(1000), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

class PostLike(Base):
    __tablename__ = "post_likes"
    post_id = Column(Integer, ForeignKey("posts.id", ondelete="CASCADE"), primary_key=True)
    user_id = Column(String(50), ForeignKey("profiles.id", ondelete="CASCADE"), primary_key=True)

class Attachment(Base):  # 파일 자체는 Supabase Storage, 여기엔 위치와 크기만
    __tablename__ = "attachments"
    id = Column(Integer, primary_key=True)
    post_id = Column(Integer, ForeignKey("posts.id", ondelete="CASCADE"), nullable=False, index=True)
    path = Column(String(200), nullable=False)
    name = Column(String(200), nullable=False)
    size = Column(Integer, nullable=False)
    mime = Column(String(100), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

class EmailForm(BaseModel):
    username : str = ""
    email : str
    password : str

# 앞뒤 공백을 지운 뒤 1글자 이상. 타입 자리에는 함수 호출을 못 써서(Pylance) Annotated로 바로 적음
class PostForm(BaseModel):
    board: Literal["국산차", "수입차", "전기차", "중고차", "정비·튜닝"]
    car: Annotated[str, StringConstraints(strip_whitespace=True, max_length=40)] | None = None
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
    content: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=5000)]

class CommentForm(BaseModel):
    content: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1000)]

# 첨부파일 저장소. Supabase 무료 플랜 Storage는 1GB라 800MB까지만 쓰고 그 뒤로는 업로드를 거절
BUCKET = "attachments"
MAX_FILE_SIZE = 4 * 1024 * 1024  # Lambda 요청 한도 6MB (파일은 전송 중 약 1.33배로 커짐)
MAX_FILES_PER_POST = 5
STORAGE_BUDGET = 800 * 1024 * 1024
ALLOWED_MIME = {"image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf",
                "text/plain", "application/zip", "application/x-zip-compressed"}

def setup_database():  # 테이블·RLS·Storage 버킷 준비. 여러 번 실행해도 안전
    #테이블 없을 때 생성해주는 함수
    Base.metadata.create_all(bind=engine)
    # 모든 테이블을 Supabase REST(anon 키)로 직접 못 건드리게 RLS를 켬. 이 서버는 postgres 계정이라 영향 없음
    # (profiles에는 이메일이 있어서 꺼져 있으면 공개 키만으로 가입자 이메일이 보임)
    with engine.begin() as conn:
        for table in ("profiles", "posts", "comments", "post_likes", "attachments"):
            conn.execute(text(f"alter table {table} enable row level security"))

    # 버킷(공개 읽기)과 정책: 로그인한 사람만 올리고, 올린 사람만 지울 수 있음
    with engine.begin() as conn:
        conn.execute(text("""
            insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
            values (:id, :id, true, :limit, :mimes)
            on conflict (id) do update set public = true, file_size_limit = :limit, allowed_mime_types = :mimes
        """), {"id": BUCKET, "limit": MAX_FILE_SIZE, "mimes": sorted(ALLOWED_MIME)})
        policies = {
            "attachments_insert": "for insert to authenticated with check (bucket_id = 'attachments')",
            "attachments_select_own": "for select to authenticated using (bucket_id = 'attachments' and owner_id = auth.uid()::text)",
            "attachments_delete_own": "for delete to authenticated using (bucket_id = 'attachments' and owner_id = auth.uid()::text)",
        }
        existing = {r[0] for r in conn.execute(text("select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects'"))}
        for name, rule in policies.items():
            if name not in existing:
                conn.execute(text(f"create policy {name} on storage.objects {rule}"))

# Lambda는 요청이 올 때마다 새로 켜질 수 있어서 매번 하지 않음 (배포 때 deploy.sh가 한 번 실행)
if not os.environ.get("AWS_LAMBDA_FUNCTION_NAME"):
    setup_database()

#요청 받아 세션을 열고 끝나면 닫는 함수
def get_db():
    db = Session(bind=engine)
    try:
        yield db
    finally:
        db.close()

app = FastAPI()

@app.get("/")
def read_home():
    return{
        "hello": "world"
    }

def save_profile(db: Session, user, username,provider):
    profile = db.get(Profile, user.id)
    if profile is None:
        profile = Profile(id = user.id, email = user.email, username = username, provider = provider)
        db.add(profile)
        db.commit()
        db.refresh(profile)
    return profile

@app.post("/signup")
def signup(form: EmailForm, db: Session=Depends(get_db)):
    res = supabase.auth.sign_up({
        "email": form.email,
        "password": form.password
        })
    profile = save_profile(db, res.user,form.username,"email")
    return {"id": profile.id, "email": profile.email, "username": profile.username}

@app.post("/login")
def login(form:EmailForm):
    try: 
        res = supabase.auth.sign_in_with_password({
            "email": form.email,
            "password": form.password
        })
    except:
        raise HTTPException(status_code=401, detail="wrong email or password.")
    return {
        "access_token": res.session.access_token,
    }

@app.get("/check-username") #닉네임 중복체크
def check_username(username: str, db: Session = Depends(get_db)):
    taken = db.query(Profile).filter(Profile.username == username).first() is not None
    return {"available": not taken}

bearer = HTTPBearer()
optional_bearer = HTTPBearer(auto_error=False)

def user_id_from_token(token: str) -> str:
    try:
        return supabase.auth.get_user(token).user.id
    except AuthError:
        raise HTTPException(status_code=401, detail="로그인이 만료됐어요. 다시 로그인하세요.")

#로그인한 사람의 프로필. /me와 글쓰기·댓글·좋아요가 같이 씀
def current_profile(cred: HTTPAuthorizationCredentials = Depends(bearer), db: Session = Depends(get_db)) -> Profile:
    profile = db.get(Profile, user_id_from_token(cred.credentials))
    if profile is None:
        raise HTTPException(status_code=404, detail="프로필이 없어요. 회원가입을 다시 하세요.")
    return profile

@app.get("/me") #로그인한 사람의 정보만 보여주는 로직
def me(profile: Profile = Depends(current_profile)):
    return{
        "id": profile.id,
        "username": profile.username,
        "email": profile.email,
        "provider": profile.provider
    }

# 소셜 로그인 (카카오, 구글)
@app.get("/login/{provider}")
def login_social(provider: Literal["kakao", "google"]):
    res = supabase.auth.sign_in_with_oauth({
        "provider": provider,
        "options": {"redirect_to": API_URL + "/auth/callback"}
    })
    # PKCE 검증값을 로그인 시작한 브라우저 쿠키에 묶음: 다른 브라우저의 code로는 콜백이 통과 못 함
    verifier = supabase.auth._storage.get_item(f"{supabase.auth._storage_key}-code-verifier").partition("/")[0]
    redirect = RedirectResponse(res.url)
    redirect.set_cookie("pkce", verifier, max_age=600, httponly=True, samesite="lax", path=CALLBACK_PATH)
    return redirect

# 소셜 로그인 후 Supabase가 돌려보내는 곳: code를 세션으로 바꾸고 프로필 저장 후 프론트 메인으로 보냄
@app.get("/auth/callback")
def auth_callback(code: str | None = None, pkce: str | None = Cookie(None), db: Session = Depends(get_db)):
    if not code or not pkce:  # 동의 취소, 카카오/구글 쪽 에러, 또는 이 브라우저에서 시작한 로그인이 아님
        return RedirectResponse(f"{FRONTEND_URL}/login?error=social")
    try:
        res = supabase.auth.exchange_code_for_session({"auth_code": code, "code_verifier": pkce})
    except AuthApiError:
        return RedirectResponse(f"{FRONTEND_URL}/login?error=social")

    user = res.user
    provider = user.app_metadata.get("provider", "social")
    name = user.user_metadata.get("name") or user.user_metadata.get("full_name") or provider
    if db.query(Profile).filter(Profile.username == name).first():  # 닉네임 unique 충돌 방지
        name = f"{name}_{user.id[:6]}"
    save_profile(db, user, name, provider)
    # 토큰은 # 뒤에 붙여야 서버 로그/Referer로 새지 않음
    redirect = RedirectResponse(f"{FRONTEND_URL}/#token={res.session.access_token}")
    redirect.delete_cookie("pkce", path=CALLBACK_PATH)  # 한 번만 사용
    return redirect


# ───────── 자동차 토론 게시판 ─────────

like_count = select(func.count()).where(PostLike.post_id == Post.id).correlate(Post).scalar_subquery()
comment_count = select(func.count()).where(Comment.post_id == Post.id).correlate(Post).scalar_subquery()

def post_rows(db: Session, *where, order, limit, offset=0):
    # 글 + 작성자 닉네임 + 좋아요/댓글 수를 쿼리 한 번으로 (글마다 따로 세지 않음)
    q = (select(Post, Profile.username, like_count, comment_count)
         .join(Profile, Profile.id == Post.author_id)
         .where(*where).order_by(*order).limit(limit).offset(offset))
    return [
        {"id": p.id, "board": p.board, "car": p.car, "title": p.title, "content": p.content,
         "author": author, "author_id": p.author_id, "views": p.views, "likes": likes, "comments": comments,
         "created_at": p.created_at, "updated_at": p.updated_at}
        for p, author, likes, comments in db.execute(q)
    ]

def viewer_id(cred: HTTPAuthorizationCredentials | None = Depends(optional_bearer)) -> str | None:
    if cred is None:
        return None
    try:
        return user_id_from_token(cred.credentials)
    except HTTPException:  # 만료된 토큰이어도 글 읽기는 가능
        return None

def own(db: Session, model, item_id: int, me: Profile):
    item = db.get(model, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="이미 삭제됐어요.")
    if item.author_id != me.id:
        raise HTTPException(status_code=403, detail="내가 쓴 것만 고치거나 지울 수 있어요.")
    return item

@app.get("/posts")
def list_posts(board: str | None = None, car: str | None = None,
               sort: Literal["latest", "hot"] = "latest",
               limit: int = Query(20, ge=1, le=50), offset: int = Query(0, ge=0),
               db: Session = Depends(get_db)):
    where = [Post.board == board] if board else []
    if car:
        where.append(Post.car == car)
    order = [(like_count + comment_count).desc(), Post.created_at.desc()] if sort == "hot" else [Post.created_at.desc()]
    rows = post_rows(db, *where, order=order, limit=limit, offset=offset)
    for row in rows:
        row["content"] = row["content"][:300]  # 목록은 미리보기만
    return rows

@app.get("/posts/{post_id}")
def read_post(post_id: int, viewer: str | None = Depends(viewer_id), db: Session = Depends(get_db)):
    db.execute(update(Post).where(Post.id == post_id).values(views=Post.views + 1))  # 동시 조회에도 안 빠지게 DB에서 +1
    db.commit()
    rows = post_rows(db, Post.id == post_id, order=[Post.id], limit=1)
    if not rows:
        raise HTTPException(status_code=404, detail="이미 삭제됐거나 없는 글이에요.")
    post = rows[0]
    post["liked"] = viewer is not None and db.get(PostLike, (post_id, viewer)) is not None
    comments = db.execute(
        select(Comment, Profile.username).join(Profile, Profile.id == Comment.author_id)
        .where(Comment.post_id == post_id).order_by(Comment.created_at)
    )
    post["comment_list"] = [
        {"id": c.id, "author": author, "author_id": c.author_id, "content": c.content, "created_at": c.created_at}
        for c, author in comments
    ]
    post["attachments"] = [attachment_json(a) for a in
                           db.scalars(select(Attachment).where(Attachment.post_id == post_id).order_by(Attachment.id))]
    return post

@app.post("/posts", status_code=201)
def create_post(form: PostForm, me: Profile = Depends(current_profile), db: Session = Depends(get_db)):
    post = Post(author_id=me.id, **form.model_dump())
    db.add(post)
    db.commit()
    return {"id": post.id}

@app.put("/posts/{post_id}")
def update_post(post_id: int, form: PostForm, me: Profile = Depends(current_profile), db: Session = Depends(get_db)):
    post = own(db, Post, post_id, me)
    for key, value in form.model_dump().items():
        setattr(post, key, value)
    post.updated_at = func.now()
    db.commit()
    return {"id": post.id}

@app.delete("/posts/{post_id}", status_code=204)
def delete_post(post_id: int, cred: HTTPAuthorizationCredentials = Depends(bearer),
                me: Profile = Depends(current_profile), db: Session = Depends(get_db)):
    post = own(db, Post, post_id, me)
    # 첨부파일은 DB가 아니라 Storage에 있어서 먼저 직접 지움 (안 지우면 용량만 계속 차지)
    paths = list(db.scalars(select(Attachment.path).where(Attachment.post_id == post_id)))
    if paths:
        storage_request("DELETE", BUCKET, cred.credentials, json={"prefixes": paths})
    db.delete(post)  # 댓글·좋아요·첨부 기록은 DB의 ON DELETE CASCADE로 같이 삭제
    db.commit()

@app.post("/posts/{post_id}/comments", status_code=201)
def create_comment(post_id: int, form: CommentForm, me: Profile = Depends(current_profile), db: Session = Depends(get_db)):
    if db.get(Post, post_id) is None:
        raise HTTPException(status_code=404, detail="이미 삭제됐거나 없는 글이에요.")
    comment = Comment(post_id=post_id, author_id=me.id, content=form.content)
    db.add(comment)
    db.commit()
    db.refresh(comment)
    return {"id": comment.id, "author": me.username, "author_id": me.id,
            "content": comment.content, "created_at": comment.created_at}

@app.delete("/comments/{comment_id}", status_code=204)
def delete_comment(comment_id: int, me: Profile = Depends(current_profile), db: Session = Depends(get_db)):
    db.delete(own(db, Comment, comment_id, me))
    db.commit()

@app.post("/posts/{post_id}/like") #누를 때마다 좋아요/취소 전환
def toggle_like(post_id: int, me: Profile = Depends(current_profile), db: Session = Depends(get_db)):
    if db.get(Post, post_id) is None:
        raise HTTPException(status_code=404, detail="이미 삭제됐거나 없는 글이에요.")
    like = db.get(PostLike, (post_id, me.id))
    if like:
        db.delete(like)
    else:
        db.add(PostLike(post_id=post_id, user_id=me.id))
    db.commit()
    likes = db.scalar(select(func.count()).where(PostLike.post_id == post_id))
    return {"liked": like is None, "likes": likes}

@app.get("/cars/trending") #글이 많은 차종 순위
def trending_cars(db: Session = Depends(get_db)):
    rows = db.execute(
        select(Post.car, func.count().label("n")).where(Post.car.is_not(None), Post.car != "")
        .group_by(Post.car).order_by(func.count().desc()).limit(10)
    )
    return [{"car": car, "posts": n} for car, n in rows]


# ───────── 첨부파일 (Supabase Storage) ─────────

def storage_request(method: str, path: str, token: str, **kwargs):
    # 로그인한 사용자 토큰으로 호출해서 Storage 정책(올린 사람만 삭제)이 그대로 적용됨
    headers = {"Authorization": f"Bearer {token}", "apikey": SUPABASE_KEY, **kwargs.pop("headers", {})}
    try:
        res = httpx.request(method, f"{SUPABASE_URL}/storage/v1/object/{path}", headers=headers, timeout=30, **kwargs)
    except httpx.HTTPError:
        res = None
    if res is None or res.is_error:
        raise HTTPException(status_code=502, detail="파일 저장소에 연결하지 못했어요. 잠시 후 다시 시도하세요.")
    return res

def attachment_json(a: Attachment):
    return {"id": a.id, "name": a.name, "size": a.size, "mime": a.mime,
            "url": f"{SUPABASE_URL}/storage/v1/object/public/{BUCKET}/{a.path}"}

@app.post("/posts/{post_id}/attachments", status_code=201)
def upload_attachment(post_id: int, file: UploadFile, cred: HTTPAuthorizationCredentials = Depends(bearer),
                      me: Profile = Depends(current_profile), db: Session = Depends(get_db)):
    own(db, Post, post_id, me)
    data = file.file.read(MAX_FILE_SIZE + 1)  # 한도보다 1바이트만 더 읽어서 큰 파일을 메모리에 다 올리지 않음
    if not data:
        raise HTTPException(status_code=400, detail="빈 파일은 올릴 수 없어요.")
    if len(data) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="파일은 하나에 4MB까지 올릴 수 있어요.")
    if file.content_type not in ALLOWED_MIME:
        raise HTTPException(status_code=415, detail="이미지(JPG, PNG, GIF, WEBP), PDF, TXT, ZIP만 올릴 수 있어요.")
    if db.scalar(select(func.count()).where(Attachment.post_id == post_id)) >= MAX_FILES_PER_POST:
        raise HTTPException(status_code=400, detail="파일은 글 하나에 5개까지 올릴 수 있어요.")
    used = db.scalar(select(func.coalesce(func.sum(Attachment.size), 0)))
    if used + len(data) > STORAGE_BUDGET:
        raise HTTPException(status_code=507, detail="저장 공간이 가득 차서 더 올릴 수 없어요. 관리자에게 알려 주세요.")

    ext = re.sub(r"[^a-z0-9.]", "", (file.filename or "").rpartition(".")[2].lower())[:10]
    path = f"{post_id}/{uuid.uuid4().hex}{'.' + ext if ext else ''}"  # 원래 파일명은 DB에만 (한글·공백 문제 방지)
    storage_request("POST", f"{BUCKET}/{path}", cred.credentials, content=data, headers={"Content-Type": file.content_type})
    attachment = Attachment(post_id=post_id, path=path, name=(file.filename or "파일")[:200], size=len(data), mime=file.content_type)
    db.add(attachment)
    db.commit()
    db.refresh(attachment)
    return attachment_json(attachment)

@app.delete("/attachments/{attachment_id}", status_code=204)
def delete_attachment(attachment_id: int, cred: HTTPAuthorizationCredentials = Depends(bearer),
                      me: Profile = Depends(current_profile), db: Session = Depends(get_db)):
    attachment = db.get(Attachment, attachment_id)
    if attachment is None:
        raise HTTPException(status_code=404, detail="이미 삭제됐어요.")
    own(db, Post, attachment.post_id, me)
    storage_request("DELETE", BUCKET, cred.credentials, json={"prefixes": [attachment.path]})
    db.delete(attachment)
    db.commit()


# AWS Lambda 진입점. CloudFront가 /api/* 를 넘겨주므로 앞의 /api를 떼고 FastAPI로 전달
handler = Mangum(app, api_gateway_base_path="/api", lifespan="off")
