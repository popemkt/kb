package app.kb.capture.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

/**
 * kb's default design system in its dark set (`packages/app/ui/src/design-system.css`,
 * `.dark`), converted from oklch to sRGB: neutral greys, the amber primary,
 * an 8px radius. The phone app is dark only, as the receiver's toast and the
 * list are all it shows.
 */
private val KbDark =
    darkColorScheme(
        background = Color(0xFF0A0A0A), // --background oklch(0.145 0 0)
        onBackground = Color(0xFFFAFAFA), // --foreground oklch(0.985 0 0)
        surface = Color(0xFF0A0A0A),
        onSurface = Color(0xFFFAFAFA),
        surfaceContainerLowest = Color(0xFF0A0A0A),
        surfaceContainerLow = Color(0xFF121212),
        surfaceContainer = Color(0xFF171717), // --card oklch(0.205 0 0)
        surfaceContainerHigh = Color(0xFF1F1F1F),
        surfaceContainerHighest = Color(0xFF262626), // --muted oklch(0.269 0 0)
        surfaceVariant = Color(0xFF262626),
        onSurfaceVariant = Color(0xFFA1A1A1), // --muted-foreground oklch(0.708 0 0)
        primary = Color(0xFFF0A13A), // --primary oklch(0.77 0.16 70)
        onPrimary = Color(0xFF4A2410), // --primary-foreground oklch(0.28 0.07 46)
        primaryContainer = Color(0xFF3A2A14),
        onPrimaryContainer = Color(0xFFF7C77F),
        secondary = Color(0xFFA1A1A1),
        onSecondary = Color(0xFF0A0A0A),
        error = Color(0xFFFF6467), // --destructive oklch(0.704 0.191 22.2)
        onError = Color(0xFF0A0A0A),
        outline = Color(0x33FFFFFF),
        outlineVariant = Color(0x1AFFFFFF), // --border oklch(1 0 0 / 10%)
    )

private val KbShapes =
    Shapes(
        extraSmall = RoundedCornerShape(4.dp),
        small = RoundedCornerShape(6.dp),
        medium = RoundedCornerShape(8.dp), // --radius
        large = RoundedCornerShape(12.dp),
        extraLarge = RoundedCornerShape(16.dp),
    )

@Composable
fun KbTheme(content: @Composable () -> Unit) = MaterialTheme(colorScheme = KbDark, shapes = KbShapes, content = content)
