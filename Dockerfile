# 1단계: 빌드(Node)
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_DEMO_LOGIN=on
ENV VITE_DEMO_LOGIN=$VITE_DEMO_LOGIN
RUN npm run build

# 2단계: 정적 파일만 비루트 nginx로 서빙
FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
