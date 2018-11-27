FROM golang
MAINTAINER Nathan Smith <nathanrandal@gmail.com>

# gather requirements
WORKDIR src

RUN curl https://glide.sh/get | sh
COPY glide.yaml ./
RUN glide install


COPY http-rendezvous http-rendezvous

# RUN go build -v
