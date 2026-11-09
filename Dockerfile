# Copyright 2026 Google LLC.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# Use the official Node.js 22 image.
FROM node:22-slim

# Create and change to the app directory.
WORKDIR /usr/src/app

# Use the latest npm, which only runs dependency install scripts that the "allowScripts" setting
# in package.json allows.
RUN npm install -g npm@latest

# Copy application dependency manifests to the container image.
# Copying them separately prevents re-running the install on every code change.
COPY package.json package-lock.json ./
COPY overrides ./overrides

# Install the exact versions pinned in package-lock.json.
RUN npm ci

# Copy local code to the container image (see .dockerignore for excluded files).
COPY . .

# Build the application.
RUN npm run build

# Remove development dependencies.
RUN npm prune --omit=dev

# Run as the unprivileged "node" user that ships with the base image.
RUN chown -R node:node /usr/src/app
USER node

# Run the web service on container startup.
CMD ["npm", "start"]
