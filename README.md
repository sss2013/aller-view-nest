# 프로젝트 개요

AllerView 백엔드 API 서버 - 메뉴 촬영 기반 알레르기/식이제한 교차검증 서비스
- 사용자 프로필(알레르기/식이제한) CRUD 및 인증/인가
- 메뉴 분석 API: OCR 텍스트 입력 → 식재료 추출 → 위험도 판정 반환
- 3-Tier 캐싱(Redis → PostgreSQL → LLM) 및 RabbitMQ 비동기 처리

## 기술 스택

- Node.js 20 + NestJS (TypeScript)
- PostgreSQL (JSONB 활용) + TypeORM
- Redis (L1 캐시, TTL 기반)
- RabbitMQ (LLM 추론 비동기 메시지 큐)
- AWS S3 (이미지 버킷)
- Jest + Supertest (테스트)

## 빌드/테스트 명령어

- 개발 서버: `npm run start:dev`
- 프로덕션 빌드: `npm run build`
- 테스트 전체: `npm test`
- 단일 테스트: `npm test -- --testPathPattern=파일명`
- e2e 테스트: `npm run test:e2e`
- 린트: `npm run lint`

## 아키텍처 흐름

```
[AI 서버(FastAPI)] → 메뉴명 추출 결과 전송
        ↓
[백엔드 API (NestJS)]
  1. L1 Redis 조회       → 캐시 히트 시 즉시 반환
  2. L2 PostgreSQL 조회  → DB 히트 시 반환 후 Redis 갱신
  3. L3 RabbitMQ 큐잉    → LLM 비동기 추론 요청
        ↓
  사용자 프로필 교차검증 (식재료 ∩ 알레르기/식이제한)
        ↓
  안전 / 주의 / 위험 판정 반환
        ↓
[프론트엔드 (Flutter)] ← (선택) WebSocket 점진적 업데이트
```

## 캐싱 전략

- **L1 Redis**: 핫 메뉴 분석 결과 캐싱, TTL은 메뉴 성격에 따라 차등 설정
- **L2 PostgreSQL**: 메뉴명 ↔ 식재료 매핑 테이블 (JSONB 컬럼 활용)
- **L3 LLM**: L1/L2 미스 시에만 RabbitMQ를 통해 비동기 추론 요청
- 캐시 일관성: DB 업데이트 시 Redis 키 무효화 (Cache-Aside 패턴)

## 메시지 큐 설계 (RabbitMQ)

- LLM 추론 요청만 큐잉, 일반 CRUD는 동기 처리
- DLQ(Dead Letter Queue) 설정으로 실패 메시지 별도 보관
- 재시도 정책: 최대 3회, 지수 백오프 (Exponential Backoff)
- 추론 완료 후 Redis/PostgreSQL 결과 업데이트

## Rate Limiting

- Token Bucket 알고리즘으로 LLM API 호출 비용 제어
- Redis 기반 분산 Rate Limiter (다중 인스턴스 대응)
- 제한 초과 시 429 응답 + Retry-After 헤더 반환

## 코드 규칙

- `require` 대신 `import/export` 사용 (ES Modules / TypeScript)
- NestJS 모듈 단위로 책임 분리 (Module / Controller / Service / Repository)
- 에러 핸들링은 NestJS 전역 ExceptionFilter 사용
- 환경변수는 `@nestjs/config` + `.env` 파일로 관리, `.env`는 커밋하지 않음
- DTO 유효성 검사는 `class-validator` + `class-transformer` 사용
- 비동기 처리 시 `async/await` 통일, 콜백 금지

## 주요 API 엔드포인트

| Method | Path | 설명 |
|---|---|---|
| POST | /auth/signup | 회원가입 |
| POST | /auth/login | 로그인 (JWT 발급) |
| GET/PUT | /users/me/profile | 사용자 알레르기/식이제한 조회·수정 |
| POST | /menu/analyze | 메뉴명 분석 요청 (OCR 결과 입력) |
| GET | /menu/analyze/:jobId | 비동기 분석 결과 폴링 |
| GET | /restaurants | 위치 기반 식당 조회 |
