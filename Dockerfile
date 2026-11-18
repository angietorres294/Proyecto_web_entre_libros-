# 1. Usa una imagen oficial y ligera de Node.js versión 20
FROM node:22-alpine

# 2. Crea la carpeta /app dentro del contenedor y entra en ella
WORKDIR /app

# 3. Copia primero package.json y package-lock.json para aprovechar la caché
COPY package*.json ./

# 4. Instala únicamente las dependencias necesarias para ejecutar la app
RUN npm ci --omit=dev

# 5. Copia todo el resto de tu proyecto (carpeta src, public, etc.)
COPY . .

# 6. Indica el puerto en el que escucha tu servidor Express
EXPOSE 3000

# 7. Comando que ejecutará Docker cuando inicie el contenedor
CMD ["npm", "start"]