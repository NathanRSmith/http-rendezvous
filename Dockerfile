FROM node:6-slim
MAINTAINER Nathan Smith <nathanrandal@gmail.com>

RUN useradd -m rendezvous
WORKDIR /opt/rendezvous
ADD package.json http-rendezvous/package.json
RUN chown -R rendezvous:rendezvous .

USER rendezvous
RUN cd http-rendezvous && npm install
ADD * http-rendezvous/

EXPOSE 8000
CMD ["node", "http-rendezvous/run.js", "--port", "8000"]
