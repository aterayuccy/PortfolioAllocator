FROM node:22-alpine AS client-build

WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

FROM eclipse-temurin:21-jdk AS server-build

WORKDIR /app/server
COPY server/.mvn/ .mvn/
COPY server/mvnw server/pom.xml ./
RUN chmod +x mvnw && ./mvnw -B -DskipTests dependency:go-offline
COPY server/src/ src/
COPY --from=client-build /app/client/dist/ src/main/resources/static/
RUN ./mvnw -B -DskipTests package

FROM eclipse-temurin:21-jre

WORKDIR /app
COPY --from=server-build /app/server/target/demo-0.0.1-SNAPSHOT.jar app.jar
EXPOSE 1010
ENTRYPOINT ["sh", "-c", "exec java -XX:MaxRAMPercentage=75.0 -jar /app/app.jar"]
