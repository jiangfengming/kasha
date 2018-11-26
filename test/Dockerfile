FROM kasha/node-chromium

COPY . /kasha
RUN yarn global add file:/kasha
RUN kasha --version

ENTRYPOINT ["kasha"]
