FROM kasha/node-chromium

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1
ENV NODE_ENV=production
COPY ./package.json /kasha/
WORKDIR /kasha
RUN npm install
