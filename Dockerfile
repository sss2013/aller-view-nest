# Step 1: Build 환경
FROM node:16 AS builder
WORKDIR /usr/src/app

# package.json 및 package-lock.json 복사
COPY package*.json ./

# 의존성 설치
RUN npm install

# 소스 코드 복사
COPY . .

# 애플리케이션 빌드
RUN npm run build


# Step 2: Production 실행 환경
FROM node:16
WORKDIR /usr/src/app

# 빌드된 파일 및 의존성 복사
COPY --from=builder /usr/src/app/dist ./dist
COPY --from=builder /usr/src/app/package*.json ./
RUN npm install --only=production

# 기본 실행 포트 및 EXPOSE
ENV PORT 8080
EXPOSE 8080

# Start the application
CMD ["npm", "run", "start:prod"]