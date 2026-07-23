FROM golang:1.21-bookworm AS go-builder

FROM node:18-bookworm

COPY --from=go-builder /usr/local/go /usr/local/go
ENV PATH="/usr/local/go/bin:${PATH}"

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

RUN mkdir -p downloads data files

EXPOSE 3000

CMD ["node", "server.js"]
