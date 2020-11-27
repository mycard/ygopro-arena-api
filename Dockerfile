FROM node:7.2.1

RUN sed -i 's/deb.debian.org/mirrors.tuna.tsinghua.edu.cn/g;s/security.debian.org/mirrors.tuna.tsinghua.edu.cn/g' && \
	apt-get update && \
	apt-get install vim -y && \
	rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/* 
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD curl -fs http://localhost:3000/ || exit 1
WORKDIR /usr/src/app
COPY package.json /usr/src/app/

RUN npm install
COPY . /usr/src/app

# 设置时区
RUN cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime

EXPOSE 3000
CMD [ "npm", "start" ]
