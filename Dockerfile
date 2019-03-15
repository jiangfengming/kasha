FROM kasha/node-chromium

RUN yarn global add kasha@next
RUN kasha --version

ENTRYPOINT ["kasha"]
