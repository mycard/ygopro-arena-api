FROM node:buster-slim
RUN mkdir -p /usr/src/app
RUN apt-get update && apt-get install -y vim python3 build-essential curl
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD curl -fs http://localhost:3000/ || exit 1
WORKDIR /usr/src/app
COPY package*.json /usr/src/app/

RUN npm ci
COPY . /usr/src/app

# 设置时区
RUN cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime

EXPOSE 3000
CMD [ "npm", "start" ]
