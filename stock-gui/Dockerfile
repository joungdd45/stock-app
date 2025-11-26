# 1단계: React(Vite) 앱을 npm으로 빌드
FROM node:20-alpine AS build

# 작업 디렉토리 설정
WORKDIR /app

# 의존성 설치에 필요한 파일만 먼저 복사
COPY package.json package-lock.json ./

# npm으로 의존성 설치 (devDependencies 포함)
RUN npm ci || npm install

# 나머지 소스 전체 복사
COPY . .

# 프로덕션 빌드 (package.json의 "build": "tsc -b && vite build")
RUN npm run build

# 2단계: Nginx로 정적 파일 서빙
FROM nginx:1.27-alpine

# Vite 기본 빌드 결과(dist)를 Nginx 기본 루트로 복사
COPY --from=build /app/dist /usr/share/nginx/html

# 컨테이너에서 노출할 포트
EXPOSE 80

# Nginx 실행
CMD ["nginx", "-g", "daemon off;"]
