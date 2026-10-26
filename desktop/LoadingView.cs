using System.Diagnostics;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;

namespace TradeDesk.Desktop;

/// <summary>
/// Animated launch screen shown while the local server and WebView2 start.
/// Drawn natively so it appears immediately, before the web UI is ready.
/// </summary>
internal sealed class LoadingView : Control
{
    private readonly System.Windows.Forms.Timer _timer;
    private readonly Stopwatch _clock = new();
    private Bitmap? _background;
    private int _backgroundDpi;
    private Font? _markFont;
    private int _markFontDpi;

    public LoadingView()
    {
        SetStyle(
            ControlStyles.AllPaintingInWmPaint
            | ControlStyles.OptimizedDoubleBuffer
            | ControlStyles.ResizeRedraw
            | ControlStyles.UserPaint,
            true);
        Dock = DockStyle.Fill;
        BackColor = Color.FromArgb(7, 10, 19);
        AccessibleRole = AccessibleRole.ProgressBar;
        AccessibleName = "Загрузка TradeDesk";

        _timer = new System.Windows.Forms.Timer { Interval = 16 };
        _timer.Tick += (_, _) => Invalidate();
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        _clock.Restart();
        UpdateAnimation();
    }

    protected override void OnVisibleChanged(EventArgs e)
    {
        base.OnVisibleChanged(e);
        UpdateAnimation();
        Invalidate();
    }

    protected override void OnDpiChangedAfterParent(EventArgs e)
    {
        base.OnDpiChangedAfterParent(e);
        _markFont?.Dispose();
        _markFont = null;
        Invalidate();
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);

        var graphics = e.Graphics;
        var width = ClientSize.Width;
        var height = ClientSize.Height;
        if (width <= 0 || height <= 0) return;

        graphics.SmoothingMode = SmoothingMode.AntiAlias;
        graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;
        graphics.CompositingQuality = CompositingQuality.HighQuality;

        var dpi = DeviceDpi / 96f;
        var seconds = _clock.Elapsed.TotalSeconds;
        var center = new PointF(width / 2f, height / 2f - 8f * dpi);

        graphics.DrawImageUnscaled(GetBackground(width, height, dpi, center), 0, 0);

        var tileSize = 88f * dpi;
        var orbitRadius = 120f * dpi;
        var tile = new RectangleF(
            center.X - tileSize / 2f,
            center.Y - tileSize / 2f,
            tileSize,
            tileSize);

        DrawOrbit(graphics, center, orbitRadius, dpi, seconds);
        DrawMark(graphics, tile, tileSize, dpi);
        DrawProgress(graphics, center, dpi, seconds);
    }

    private Bitmap GetBackground(int width, int height, float dpi, PointF center)
    {
        if (_background is not null
            && _background.Size == new Size(width, height)
            && _backgroundDpi == DeviceDpi)
        {
            return _background;
        }

        _background?.Dispose();
        _background = RenderBackground(width, height, dpi, center);
        _backgroundDpi = DeviceDpi;
        return _background;
    }

    private static Bitmap RenderBackground(int width, int height, float dpi, PointF center)
    {
        var bitmap = new Bitmap(width, height, PixelFormat.Format32bppPArgb);
        using var graphics = Graphics.FromImage(bitmap);
        graphics.SmoothingMode = SmoothingMode.AntiAlias;
        graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;
        graphics.CompositingQuality = CompositingQuality.HighQuality;

        using (var background = new LinearGradientBrush(
            new Rectangle(0, 0, width, height),
            Color.FromArgb(7, 10, 19),
            Color.FromArgb(10, 15, 30),
            90f))
        {
            graphics.FillRectangle(background, 0, 0, width, height);
        }

        DrawGlow(
            graphics,
            new PointF(width * 0.14f, -height * 0.04f),
            width * 0.44f,
            Color.FromArgb(34, 93, 110, 255),
            Color.FromArgb(0, 7, 10, 19));
        DrawGlow(
            graphics,
            new PointF(width * 0.91f, height * 0.01f),
            Math.Min(width, height) * 0.3f,
            Color.FromArgb(20, 45, 212, 191),
            Color.FromArgb(0, 7, 10, 19));
        DrawGlow(
            graphics,
            center,
            Math.Min(width, height) * 0.3f,
            Color.FromArgb(24, 83, 99, 237),
            Color.FromArgb(0, 7, 10, 19));

        var gridStep = 72f * dpi;
        using (var grid = new Pen(Color.FromArgb(8, 148, 163, 184), Math.Max(1f, dpi)))
        {
            for (var x = -gridStep; x < width + gridStep; x += gridStep)
                graphics.DrawLine(grid, x, 0, x, height);
            for (var y = -gridStep; y < height + gridStep; y += gridStep)
                graphics.DrawLine(grid, 0, y, width, y);
        }

        DrawDither(graphics, width, height);
        return bitmap;
    }

    private static void DrawDither(Graphics graphics, int width, int height)
    {
        const int tileSize = 96;
        using var noise = new Bitmap(tileSize, tileSize, PixelFormat.Format32bppPArgb);
        var random = new Random(20261026);
        for (var y = 0; y < tileSize; y++)
        {
            for (var x = 0; x < tileSize; x++)
            {
                var alpha = random.Next(0, 5);
                if (alpha > 0) noise.SetPixel(x, y, Color.FromArgb(alpha, 238, 242, 255));
            }
        }

        using var brush = new TextureBrush(noise, WrapMode.Tile);
        graphics.FillRectangle(brush, 0, 0, width, height);
    }

    private void DrawOrbit(Graphics graphics, PointF center, float radius, float dpi, double seconds)
    {
        var ring = new RectangleF(
            center.X - radius,
            center.Y - radius,
            radius * 2f,
            radius * 2f);

        using (var baseRing = new Pen(Color.FromArgb(22, 185, 196, 255), Math.Max(1f, dpi)))
            graphics.DrawEllipse(baseRing, ring);

        var phase = (float)((seconds * 1.0) % (Math.PI * 2));
        var headAngle = phase * 180f / MathF.PI;
        var trailSweep = 19f;
        var trailSegments = 5;

        for (var index = 0; index < trailSegments; index++)
        {
            var alpha = 150 - index * 27;
            var start = headAngle - trailSweep * (index + 1);
            using var pen = new Pen(Color.FromArgb(alpha, 185, 196, 255), 2.1f * dpi)
            {
                StartCap = LineCap.Round,
                EndCap = LineCap.Round
            };
            graphics.DrawArc(pen, ring, start, trailSweep);
        }

        var head = new PointF(
            center.X + MathF.Cos(phase) * radius,
            center.Y + MathF.Sin(phase) * radius);

        using (var halo = new SolidBrush(Color.FromArgb(38, 141, 162, 255)))
            graphics.FillEllipse(halo, head.X - 9f * dpi, head.Y - 9f * dpi, 18f * dpi, 18f * dpi);
        using (var dot = new SolidBrush(Color.FromArgb(240, 238, 242, 255)))
            graphics.FillEllipse(dot, head.X - 3.2f * dpi, head.Y - 3.2f * dpi, 6.4f * dpi, 6.4f * dpi);
    }

    private void DrawMark(Graphics graphics, RectangleF tile, float tileSize, float dpi)
    {
        DrawGlow(
            graphics,
            new PointF(tile.X + tile.Width / 2f, tile.Y + tile.Height * 0.63f),
            tileSize * 0.72f,
            Color.FromArgb(88, 1, 4, 12),
            Color.FromArgb(0, 1, 4, 12));

        using (var tilePath = RoundedRectangle(tile, tileSize * 0.28f))
        using (var fill = new LinearGradientBrush(
            tile,
            Color.FromArgb(100, 116, 244),
            Color.FromArgb(155, 92, 246),
            135f))
        {
            graphics.FillPath(fill, tilePath);
            using var shine = new Pen(Color.FromArgb(70, 255, 255, 255), Math.Max(1f, dpi));
            graphics.DrawPath(shine, tilePath);
        }

        using var format = new StringFormat
        {
            Alignment = StringAlignment.Center,
            LineAlignment = StringAlignment.Center,
            FormatFlags = StringFormatFlags.NoClip
        };
        var glyphBounds = new RectangleF(tile.X, tile.Y - 1f * dpi, tile.Width, tile.Height);
        using (var glyphShadow = new SolidBrush(Color.FromArgb(55, 10, 5, 30)))
            graphics.DrawString("T↗", GetMarkFont(dpi), glyphShadow, glyphBounds.X, glyphBounds.Y + 1.5f * dpi, format);
        graphics.DrawString("T↗", GetMarkFont(dpi), Brushes.White, glyphBounds, format);
    }

    private static void DrawProgress(Graphics graphics, PointF center, float dpi, double seconds)
    {
        var trackWidth = 220f * dpi;
        var trackHeight = 3f * dpi;
        var track = new RectangleF(
            center.X - trackWidth / 2f,
            center.Y + 142f * dpi,
            trackWidth,
            trackHeight);

        using (var trackPath = RoundedRectangle(track, trackHeight / 2f))
        using (var trackBrush = new SolidBrush(Color.FromArgb(24, 148, 163, 184)))
            graphics.FillPath(trackBrush, trackPath);

        const double duration = 1.7;
        var progress = (seconds % duration) / duration;
        var segmentWidth = trackWidth * 0.34f;
        var travel = trackWidth - segmentWidth;
        var eased = progress < 0.5
            ? 2 * progress * progress
            : 1 - Math.Pow(-2 * progress + 2, 2) / 2;
        var segment = new RectangleF(
            track.X + (float)eased * travel,
            track.Y,
            segmentWidth,
            trackHeight);

        using var segmentPath = RoundedRectangle(segment, trackHeight / 2f);
        using var fill = new LinearGradientBrush(
            segment,
            Color.FromArgb(0, 141, 162, 255),
            Color.FromArgb(0, 141, 162, 255),
            0f);
        fill.InterpolationColors = new ColorBlend
        {
            Colors =
            [
                Color.FromArgb(0, 141, 162, 255),
                Color.FromArgb(225, 201, 209, 255),
                Color.FromArgb(0, 141, 162, 255)
            ],
            Positions = [0f, 0.5f, 1f]
        };
        graphics.FillPath(fill, segmentPath);
    }

    private Font GetMarkFont(float dpi)
    {
        if (_markFont is not null && _markFontDpi == DeviceDpi) return _markFont;
        _markFont?.Dispose();
        _markFontDpi = DeviceDpi;
        _markFont = new Font("Segoe UI", 31f * dpi, FontStyle.Bold, GraphicsUnit.Pixel);
        return _markFont;
    }

    private static void DrawGlow(Graphics graphics, PointF center, float radius, Color inner, Color outer)
    {
        if (radius <= 0) return;

        using var path = new GraphicsPath();
        path.AddEllipse(center.X - radius, center.Y - radius, radius * 2f, radius * 2f);
        using var brush = new PathGradientBrush(path)
        {
            CenterColor = inner,
            CenterPoint = center,
            SurroundColors = [outer]
        };
        brush.SetSigmaBellShape(0.62f);
        graphics.FillPath(brush, path);
    }

    private static GraphicsPath RoundedRectangle(RectangleF bounds, float radius)
    {
        var path = new GraphicsPath();
        var diameter = Math.Min(radius * 2f, Math.Min(bounds.Width, bounds.Height));
        if (diameter <= 0)
        {
            path.AddRectangle(bounds);
            return path;
        }

        var arc = new RectangleF(bounds.X, bounds.Y, diameter, diameter);
        path.AddArc(arc, 180, 90);
        arc.X = bounds.Right - diameter;
        path.AddArc(arc, 270, 90);
        arc.Y = bounds.Bottom - diameter;
        path.AddArc(arc, 0, 90);
        arc.X = bounds.X;
        path.AddArc(arc, 90, 90);
        path.CloseFigure();
        return path;
    }

    private void UpdateAnimation()
    {
        if (IsHandleCreated && Visible)
        {
            if (!_clock.IsRunning) _clock.Start();
            if (!_timer.Enabled) _timer.Start();
        }
        else
        {
            _timer.Stop();
            _clock.Stop();
        }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _timer.Stop();
            _timer.Dispose();
            _markFont?.Dispose();
            _background?.Dispose();
        }
        base.Dispose(disposing);
    }
}
