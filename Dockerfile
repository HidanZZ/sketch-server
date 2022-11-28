FROM node:alpine AS node-builder

WORKDIR /backend

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

FROM heroiclabs/nakama:3.3.0
COPY . /nakama/data/modules
COPY --from=node-builder /backend/build/*.js /nakama/data/modules/
COPY local.yml /nakama/data/
