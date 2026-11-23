package com.jpluker.spotifyalt

import com.jpluker.spotifyalt.UrlPolicy.Decision.BLOCK
import com.jpluker.spotifyalt.UrlPolicy.Decision.EXTERNAL
import com.jpluker.spotifyalt.UrlPolicy.Decision.LOAD
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class UrlPolicyTest {
    @Test fun playerAndSignInStayInTheApp() {
        assertEquals(LOAD, UrlPolicy.decide("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M"))
        assertEquals(LOAD, UrlPolicy.decide("https://accounts.spotify.com/en/login"))
        assertEquals(LOAD, UrlPolicy.decide("https://accounts.google.com/o/oauth2/auth"))
        assertEquals(LOAD, UrlPolicy.decide("about:blank"))
    }

    @Test fun otherSitesGoToTheBrowser() {
        assertEquals(EXTERNAL, UrlPolicy.decide("https://www.spotify.com/us/premium/"))
        assertEquals(EXTERNAL, UrlPolicy.decide("http://open.spotify.com/"))
        assertEquals(EXTERNAL, UrlPolicy.decide("https://open.spotify.com.evil.example/"))
    }

    @Test fun appLinksAndScriptsGoNowhere() {
        assertEquals(BLOCK, UrlPolicy.decide("spotify:track:4uLU6hMCjMI75M1A2tKUQC"))
        assertEquals(BLOCK, UrlPolicy.decide("intent://open#Intent;scheme=spotify;end"))
        assertEquals(BLOCK, UrlPolicy.decide("javascript:alert(1)"))
        assertEquals(BLOCK, UrlPolicy.decide("file:///sdcard/x"))
        assertEquals(BLOCK, UrlPolicy.decide("https://user:pw@open.spotify.com/"))
        assertEquals(BLOCK, UrlPolicy.decide("not a url"))
        assertEquals(BLOCK, UrlPolicy.decide(null))
    }

    @Test fun onlyPlayerLinksFromOtherApps() {
        assertTrue(UrlPolicy.isPlayer("https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=1"))
        assertFalse(UrlPolicy.isPlayer("https://accounts.spotify.com/"))
        assertNull(UrlPolicy.playerUrlFrom("https://example.com/"))
        assertEquals("https://open.spotify.com/album/x", UrlPolicy.playerUrlFrom("https://open.spotify.com/album/x"))
    }
}
