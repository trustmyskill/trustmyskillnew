FROM node:18-bullseye

RUN dpkg --add-architecture i386 && \
    apt-get update && \
    apt-get install -y --no-install-recommends \
    wine wine64 \
    python3 python3-pip python3-dev \
    wget cabextract \
    xvfb && \
    rm -rf /var/lib/apt/lists/*

RUN wget -q "https://www.python.org/ftp/python/3.11.4/python-3.11.4-amd64.exe" -O /tmp/py.exe && \
    xvfb-run wine64 /tmp/py.exe /quiet InstallAllUsers=0 PrependPath=0 Include_test=0 TargetDir=C:\\Python311 && \
    rm /tmp/py.exe || echo "Wine python install attempt done"

RUN xvfb-run wine64 C:\\Python311\\python.exe -m pip install --upgrade pip 2>&1 | tail -5; \
    xvfb-run wine64 C:\\Python311\\python.exe -m pip install pyinstaller==5.13.2 websocket-client psutil Pillow pynput requests 2>&1 | tail -5 || echo "Wine pip done"

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

RUN chmod +x *.js

EXPOSE 3000

CMD ["node", "server.js"]
