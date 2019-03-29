FROM kasha/node-chromium

COPY . /kasha
WORKDIR /kasha
RUN npm link

RUN kasha --version

ENTRYPOINT ["kasha"]
