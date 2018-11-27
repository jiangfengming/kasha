FROM kasha/node-chromium

COPY . /kasha
RUN ln -s /kasha/bin/kasha /usr/local/bin/kasha
RUN kasha --version

ENTRYPOINT ["kasha"]
