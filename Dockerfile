# asciigraph as a container: builds the static app, then serves it with nginx.
#   docker build -t asciigraph .
#   docker run -d --name asciigraph -p 8080:8080 --restart unless-stopped asciigraph
# then open http://localhost:8080/. Diagrams are kept in the browser (localStorage), so the
# container holds no data and can be replaced freely.
#
# The command line is the "cli" target:
#   docker build --target cli -t asciigraph-cli .
#   docker run --rm -i asciigraph-cli < flow.mmd

FROM docker.io/library/node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
# Playwright's browsers are only for the e2e tests.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci
COPY . .
RUN npm run build && npm run build:cli

# The command line: asciigraph render / mermaid / markdown, on files in /data.
FROM docker.io/library/node:22-alpine AS cli
COPY --from=build /app/cli/asciigraph.mjs /usr/local/lib/asciigraph.mjs
WORKDIR /data
USER node
ENTRYPOINT ["node", "/usr/local/lib/asciigraph.mjs"]

FROM docker.io/nginxinc/nginx-unprivileged:1.27-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
