FROM mcr.microsoft.com/playwright:v1.49.0-jammy

WORKDIR /app

# Copy the whole workspace — npm workspaces needs every member's package.json
# present to resolve symlinks, and there's no build step to prune afterward.
COPY package.json package-lock.json ./
COPY packages ./packages
COPY apps ./apps
COPY evals ./evals

RUN npm install

ENV PORT=3001
EXPOSE 3001

CMD ["npm", "run", "start", "-w", "@stock-indicator-dailies/api"]
