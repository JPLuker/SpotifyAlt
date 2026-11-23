package com.jpluker.spotifyalt

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PlayerStateTest {
    private val track = "spotify:track:4uLU6hMCjMI75M1A2tKUQC"

    @Test fun readsExtensionState() {
        val s = PlayerState.fromExtension(
            JSONObject(
                """{"title":"Song","artist":"Band","album":"LP","artwork":"https://i.scdn.co/image/x",
                   "playing":true,"uri":"$track","liked":true}"""
            ),
            PlayerState(positionMs = 5000),
        )
        assertEquals("Song", s.title)
        assertEquals("Band", s.artist)
        assertEquals("https://i.scdn.co/image/x", s.artworkUrl)
        assertEquals(true, s.playing)
        assertEquals(track, s.uri)
        assertEquals(true, s.liked)
        assertEquals(5000, s.positionMs) // GeckoView's position is kept
    }

    @Test fun unknownLikedStaysUnknown() {
        val s = PlayerState.fromExtension(JSONObject("""{"uri":"$track","liked":null}"""), PlayerState(liked = true))
        assertNull(s.liked)
        val t = PlayerState.fromExtension(JSONObject("""{"uri":"$track","liked":"true"}"""), PlayerState())
        assertNull(t.liked)
    }

    @Test fun badValuesAreDropped() {
        val s = PlayerState.fromExtension(
            JSONObject("""{"title":"${"x".repeat(1000)}","artwork":"http://insecure","uri":"javascript:x"}"""),
            PlayerState(),
        )
        assertEquals(300, s.title.length)
        assertNull(s.artworkUrl)
        assertNull(s.uri)
    }
}
