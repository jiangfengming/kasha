FROM kasha/node-chromium

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1
COPY . /kasha
WORKDIR /kasha
RUN npm link

RUN kasha --version

ENTRYPOINT ["kasha", "--chromium-path=google-chrome-unstable"]
