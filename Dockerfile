FROM node:22-alpine AS build
WORKDIR /app
COPY stylique-crm-deploy-ready.zip ./
RUN apk add --no-cache unzip \
  && unzip -o stylique-crm-deploy-ready.zip \
  && rm stylique-crm-deploy-ready.zip
RUN npm ci
RUN npm run build

FROM node:22-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/package.json ./package.json
EXPOSE 8787
CMD ["node", "server/index.mjs"]

