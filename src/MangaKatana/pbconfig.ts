import { ContentRating, SourceInfo, SourceIntents } from "@paperback/types";

export default {
    name: "MangaKatana",
    description: "Extension that pulls content from mangakatana.com.",
    version: "1.0.0-alpha.2",
    icon: "icon.png",
    language: "en",
    contentRating: ContentRating.EVERYONE,
    capabilities: [
        SourceIntents.DISCOVER_SECIONS,
        SourceIntents.MANGA_SEARCH,
        SourceIntents.MANGA_CHAPTERS,
    ],
    badges: [],
    developers: [
        {
            name: "Egwau",
        },
    ],
} satisfies SourceInfo;
