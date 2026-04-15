FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 8080
CMD ["node", "api/server.js"]
And make sure your package.json start script points to the right file:
"scripts": {
"start": "node api/server.js"
}