FROM kasha/node-chromium

RUN yarn global add kasha
RUN kasha --version

ENTRYPOINT ["kasha"]
