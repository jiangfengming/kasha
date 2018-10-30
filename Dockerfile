FROM buildkite/puppeteer:latest
RUN yarn global add kasha
RUN kasha-server --version
