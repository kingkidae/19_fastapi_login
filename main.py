from fastapi import FastAPI, Depends,HTTPException
from sqlalchemy import create_engine, Column, Integer, String # sqlalchemy는 db를 다루는 라이브러리로 유효성을 검사함.
from sqlalchemy.orm import declarative_base, Session
from pydantic import BaseModel #사용 전에 유용한지 아닌지 여부 확인하는 라이브러리
from supabase import create_client,ClientOptions

DATABASE_URL = "postgresql://postgres.idncnltjwdlhkffcdmnv:nqnCMEkscYd8cyLC@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres"
# 슈파베이스 프로젝트 오버뷰 해서 커넥트 누르고, 다이렉트 커넥트, 세션풀러 선택해서 스크롤 내리면 커넥트 스트링 옆에 쉐어드풀러 에 있는 링크입력하면 됨. 링크 내 [유어 패스워드]비번은 프로젝트 생성할 때 정한 비번치면 됨. 대괄호까지 없애줘야 함.
# 비번 까먹었을 때 슈파베이스 - 데이터베이스 - 세팅즈 - 리셋 패스워드눌리면 재설정 가능함. DB같은 경우는 평소쓰던 비번 쓰면 리스키하기 때문에 비번 재생성 만드는 창에서 제너레이트 패스워드하면 어려운 비번 알아서 세팅해줌.
engine = create_engine(DATABASE_URL)
Base = declarative_base()

SUPABASE_URL = "https://idncnltjwdlhkffcdmnv.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlkbmNubHRqd2RsaGtmZmNkbW52Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ3NzU2NzQsImV4cCI6MjExMDM1MTY3NH0.tTE5bYbKVB09U0-9FzqfsAR0RMY04TGJMjloRsuGYk8"
supabase = create_client(SUPABASE_URL, SUPABASE_KEY,options=ClientOptions(flow_type="pkce"))

#table model 생성 (table name: users) 클래스는 객체를 만들어주는 명령어임.
class Profile(Base): #테이블을 정의함. 슈파베이스 들어가보면 users라는 테이블이 있음.
    __tablename__ = "profiles"
    id = Column(Integer, primary_key = True, index = True)
    username = Column(String(50), unique = True, index = True)
    email = Column(String(120))
    provider = Column(String(50))

class EmailForm(BaseModel):
    username : str
    email : str
    password : str

#테이블 없을 때 생성해주는 함수
Base.metadata.create_all(bind=engine)

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
        Profile(id = user.id, email = user.email, username = username, provider = provider)
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