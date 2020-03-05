FROM kasha/kasha:base

COPY . /kasha
WORKDIR /kasha
RUN npm link

RUN kasha --version

ENTRYPOINT ["dumb-init", "--", "kasha"]
