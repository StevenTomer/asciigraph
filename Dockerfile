# asciigraph as a container: builds the static app, then serves it with nginx.
#   docker build -t asciigraph .
#   docker run -d --name asciigraph -p 8080:8080 --restart unless-stopped asciigraph
# then open http://localhost:8080/. Diagrams are kept in the browser (localStorage), so the
# container holds no data and can be replaced freely.
#
# Live diagrams (edited by several people at once) need the "collab" target running too, with
# this one passing api/ and ws to it: compose.yaml does both.
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
RUN npm run build && npm run build:cli && npm run build:server

# The command line: asciigraph render / mermaid / markdown, on files in /data.
FROM docker.io/library/node:22-alpine AS cli
COPY --from=build /app/cli/asciigraph.mjs /usr/local/lib/asciigraph.mjs
WORKDIR /data
USER node
ENTRYPOINT ["node", "/usr/local/lib/asciigraph.mjs"]

# The live-editing server: shared diagrams in /data (a volume), on port 1234.
FROM docker.io/library/node:22-alpine AS collab
COPY --from=build /app/server-dist/server.mjs /usr/local/lib/asciigraph-server.mjs
RUN mkdir /data && chown node:node /data
VOLUME /data
WORKDIR /data
USER node
ENV PORT=1234 ASCIIGRAPH_DB=/data/asciigraph.db NODE_NO_WARNINGS=1
EXPOSE 1234
HEALTHCHECK --interval=30s --timeout=3s CMD wget -q -O /dev/null http://127.0.0.1:1234/api/health || exit 1
CMD ["node", "/usr/local/lib/asciigraph-server.mjs"]

FROM docker.io/nginxinc/nginx-unprivileged:1.27-alpine
# A template: the image fills in NGINX_LOCAL_RESOLVERS (the DNS server) when it starts.
COPY docker/nginx.conf /etc/nginx/templates/default.conf.template
ENV NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
