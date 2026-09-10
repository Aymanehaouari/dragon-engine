FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build

RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src

# Use the actual Tyrrrz/YoutubeDownloader repository as the download engine.
RUN git clone --depth 1 --branch prime \
    https://github.com/Tyrrrz/YoutubeDownloader.git \
    /src/YoutubeDownloader

COPY container/ /src/bridge/

RUN dotnet restore /src/bridge/DragonBridge.csproj
RUN dotnet publish /src/bridge/DragonBridge.csproj \
    -c Release \
    -o /app/publish \
    --no-restore


FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=build /app/publish/ ./

ENV ASPNETCORE_URLS=http://0.0.0.0:8080

EXPOSE 8080

ENTRYPOINT ["dotnet", "DragonBridge.dll"]
