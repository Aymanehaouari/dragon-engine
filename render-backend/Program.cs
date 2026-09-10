using YoutubeDownloader.Core.Downloading;
using YoutubeExplode;
using YoutubeExplode.Videos;
using YoutubeExplode.Videos.Streams;

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls("http://0.0.0.0:" + (Environment.GetEnvironmentVariable("PORT") ?? "10000"));

var app = builder.Build();

var token = Environment.GetEnvironmentVariable("DRAGON_BRIDGE_TOKEN") ?? "";

app.MapGet("/health", () => Results.Ok(new
{
    ok = true,
    engine = "Tyrrrz/YoutubeDownloader.Core",
    host = "Render"
}));

app.MapGet("/api/download", async (
    HttpContext context,
    string url,
    string format,
    CancellationToken cancellationToken
) =>
{
    var auth = context.Request.Headers.Authorization.ToString();
    if (string.IsNullOrWhiteSpace(token) || auth != "Bearer " + token)
        return Results.Unauthorized();

    format = (format ?? "").Trim().ToLowerInvariant();

    if (format is not ("mp3" or "mp4"))
        return Results.BadRequest(new { error = "Format must be mp3 or mp4." });

    if (!Uri.TryCreate(url, UriKind.Absolute, out var uri))
        return Results.BadRequest(new { error = "Invalid source URL." });

    var host = uri.Host.ToLowerInvariant();
    if (host is not ("youtube.com" or "www.youtube.com" or "youtu.be" or "m.youtube.com"))
        return Results.BadRequest(new { error = "Only YouTube URLs are accepted by this bridge." });

    VideoId videoId;
    try
    {
        videoId = VideoId.Parse(url);
    }
    catch
    {
        return Results.BadRequest(new { error = "Could not parse YouTube video ID." });
    }

    string? tempPath = null;

    try
    {
        using var youtube = new YoutubeClient();
        var video = await youtube.Videos.GetAsync(videoId, cancellationToken);

        var targetContainer = format == "mp3" ? Container.Mp3 : Container.Mp4;

        // Free Render has only 512 MB RAM, so keep MP4 to <=720p.
        var preference = new VideoDownloadPreference(
            targetContainer,
            format == "mp3"
                ? VideoQualityPreference.Lowest
                : VideoQualityPreference.UpTo720p
        );

        using var downloader = new VideoDownloader();

        var option = await downloader.GetBestDownloadOptionAsync(
            video.Id,
            preference,
            includeLanguageSpecificAudioStreams: false,
            cancellationToken
        );

        var extension = format == "mp3" ? ".mp3" : ".mp4";
        tempPath = Path.Combine(
            Path.GetTempPath(),
            "dragon-" + Guid.NewGuid().ToString("N") + extension
        );

        await downloader.DownloadVideoAsync(
            tempPath,
            video,
            option,
            includeSubtitles: false,
            ffmpegPath: "ffmpeg",
            progress: null,
            cancellationToken
        );

        var name = CleanFileName(video.Title) + extension;

        context.Response.OnCompleted(() =>
        {
            try
            {
                if (tempPath is not null && File.Exists(tempPath))
                    File.Delete(tempPath);
            }
            catch { }
            return Task.CompletedTask;
        });

        return Results.File(
            tempPath,
            format == "mp3" ? "audio/mpeg" : "video/mp4",
            name
        );
    }
    catch (Exception ex)
    {
        try
        {
            if (tempPath is not null && File.Exists(tempPath))
                File.Delete(tempPath);
        }
        catch { }

        Console.Error.WriteLine(ex);
        return Results.Problem(
            title: "Download failed",
            detail: ex.Message,
            statusCode: 500
        );
    }
});

app.Run();

static string CleanFileName(string value)
{
    var invalid = Path.GetInvalidFileNameChars().ToHashSet();
    var cleaned = new string(
        (value ?? "dragon-media")
            .Where(ch => !invalid.Contains(ch))
            .ToArray()
    ).Trim();

    if (cleaned.Length > 120)
        cleaned = cleaned[..120];

    return string.IsNullOrWhiteSpace(cleaned) ? "dragon-media" : cleaned;
}
