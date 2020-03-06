FROM kasha/kasha:base

COPY . /kasha
WORKDIR /kasha
RUN npm link
RUN npm cache clean --force

RUN kasha --version

ENTRYPOINT ["dumb-init", "--", "kasha"]
