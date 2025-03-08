import {
    BasicRateLimiter,
    Chapter,
    ChapterDetails,
    ChapterProviding,
    CloudflareError,
    ContentRating,
    DiscoverSection,
    DiscoverSectionItem,
    DiscoverSectionProviding,
    DiscoverSectionType,
    Extension,
    MangaProviding,
    PagedResults,
    Request,
    SearchFilter,
    SearchQuery,
    SearchResultItem,
    SearchResultsProviding,
    SourceManga,
    TagSection,
} from "@paperback/types";
import * as cheerio from "cheerio";
import { CheerioAPI } from "cheerio";
import * as htmlparser2 from "htmlparser2";
import { URLBuilder } from "../utils/url-builder/base";
import { FireInterceptor } from "./MangaFireInterceptor";

const baseUrl = "https://mangafire.to";

type MangaFireImplementation = Extension &
    SearchResultsProviding &
    MangaProviding &
    ChapterProviding &
    DiscoverSectionProviding;

export class MangaFireExtension implements MangaFireImplementation {
    requestManager = new FireInterceptor("main");
    globalRateLimiter = new BasicRateLimiter("rateLimiter", {
        numberOfRequests: 10,
        bufferInterval: 1,
        ignoreImages: true,
    });

    async initialise(): Promise<void> {
        this.requestManager.registerInterceptor();
        this.globalRateLimiter.registerInterceptor();
    }

    async getDiscoverSections(): Promise<DiscoverSection[]> {
        return [
            {
                id: "popular_section",
                title: "Popular",
                type: DiscoverSectionType.featured,
            },
            {
                id: "updated_section",
                title: "Recently Updated",
                type: DiscoverSectionType.chapterUpdates,
            },
            {
                id: "new_manga_section",
                title: "New Manga",
                type: DiscoverSectionType.simpleCarousel,
            },
            {
                id: "genres_section",
                title: "Genres",
                type: DiscoverSectionType.genres,
            },
        ];
    }

    async getDiscoverSectionItems(
        section: DiscoverSection,
        metadata: MangaFire.Metadata | undefined,
    ): Promise<PagedResults<DiscoverSectionItem>> {
        switch (section.id) {
            case "popular_section":
                return this.getPopularSectionItems(section, metadata);
            case "updated_section":
                return this.getUpdatedSectionItems(section, metadata);
            case "new_manga_section":
                return this.getNewMangaSectionItems(section, metadata);
            case "genres_section":
                return this.getFilterSection();
            default:
                return { items: [] };
        }
    }

    async getSearchFilters(): Promise<SearchFilter[]> {
        const filters: SearchFilter[] = [];
        filters.push({
            id: "type",
            type: "dropdown",
            options: [
                { id: "all", value: "All" },
                { id: "manhua", value: "Manhua" },
                { id: "manhwa", value: "Manhwa" },
                { id: "manga", value: "Manga" },
            ],
            value: "all",
            title: "Type Filter",
        });

        filters.push({
            id: "genres",
            type: "multiselect",
            options: [
                { id: "1", value: "Action" },
                { id: "78", value: "Adventure" },
                { id: "3", value: "Avant Garde" },
                { id: "4", value: "Boys Love" },
                { id: "5", value: "Comedy" },
                { id: "77", value: "Demons" },
                { id: "6", value: "Drama" },
                { id: "7", value: "Ecchi" },
                { id: "79", value: "Fantasy" },
                { id: "9", value: "Girls Love" },
                { id: "10", value: "Gourmet" },
                { id: "11", value: "Harem" },
                { id: "530", value: "Horror" },
                { id: "13", value: "Isekai" },
                { id: "531", value: "Iyashikei" },
                { id: "15", value: "Josei" },
                { id: "532", value: "Kids" },
                { id: "539", value: "Magic" },
                { id: "533", value: "Mahou Shoujo" },
                { id: "534", value: "Martial Arts" },
                { id: "19", value: "Mecha" },
                { id: "535", value: "Military" },
                { id: "21", value: "Music" },
                { id: "22", value: "Mystery" },
                { id: "23", value: "Parody" },
                { id: "536", value: "Psychological" },
                { id: "25", value: "Reverse Harem" },
                { id: "26", value: "Romance" },
                { id: "73", value: "School" },
                { id: "28", value: "Sci-Fi" },
                { id: "537", value: "Seinen" },
                { id: "30", value: "Shoujo" },
                { id: "31", value: "Shounen" },
                { id: "538", value: "Slice of Life" },
                { id: "33", value: "Space" },
                { id: "34", value: "Sports" },
                { id: "75", value: "Super Power" },
                { id: "76", value: "Supernatural" },
                { id: "37", value: "Suspense" },
                { id: "38", value: "Thriller" },
                { id: "39", value: "Vampire" },
            ],
            allowExclusion: true,
            value: {},
            title: "Genre Filter",
            allowEmptySelection: false,
            maximum: undefined,
        });

        filters.push({
            id: "status",
            type: "dropdown",
            options: [
                { id: "all", value: "All" },
                { id: "completed", value: "Completed" },
                { id: "releasing", value: "Releasing" },
                { id: "hiatus", value: "On Hiatus" },
                { id: "discontinued", value: "Discontinued" },
                { id: "not_published", value: "Not Yet Published" },
            ],
            value: "all",
            title: "Status Filter",
        });

        return filters;
    }

    async getSearchResults(
        query: SearchQuery,
        metadata: { page?: number } | undefined,
    ): Promise<PagedResults<SearchResultItem>> {
        const page = metadata?.page ?? 1;
        // Example: https://mangafire.to/filter?keyword=one%20piece&page=1&genre_mode=and&type[]=manhwa&genre[]=action&status[]=releasing&sort=most_relevance
        // Multple Genres: https://mangafire.to/filter?keyword=one+piece&type%5B%5D=manga&genre%5B%5D=1&genre%5B%5D=31&genre_mode=and&status%5B%5D=releasing&sort=most_relevance
        // No Genre: https://mangafire.to/filter?keyword=one+piece&type%5B%5D=manga&genre_mode=and&status%5B%5D=releasing&sort=most_relevance
        // With pages: https://mangafire.to/filter?page=2&keyword=one%20piece
        // ALL: https://mangafire.to/filter?keyword=one+peice&sort=recently_updated
        // Exclude: https://mangafire.to/filter?keyword=&genre%5B%5D=-9&sort=recently_updated
        const searchUrl = new URLBuilder(baseUrl)
            .addPath("filter")
            .addQuery("keyword", query.title)
            .addQuery("page", page.toString())
            .addQuery("genre_mode", "and");

        const getFilterValue = (id: string) =>
            query.filters.find((filter) => filter.id == id)?.value;

        const type = getFilterValue("type");
        const genres = getFilterValue("genres") as
            | Record<string, "included" | "excluded">
            | undefined;
        const status = getFilterValue("status");

        if (type && type != "all") {
            searchUrl.addQuery("type[]", type);
        }

        if (genres && typeof genres === "object") {
            Object.entries(genres).forEach(([id, value]) => {
                if (value === "included") {
                    searchUrl.addQuery("genre[]", id);
                } else if (value === "excluded") {
                    searchUrl.addQuery("genre[]", `-${id}`);
                }
            });
        }

        if (status && status != "all") {
            let statusValue: string;
            switch (status) {
                case "completed":
                    statusValue = "completed";
                    break;
                case "releasing":
                    statusValue = "releasing";
                    break;
                case "hiatus":
                    statusValue = "hiatus";
                    break;
                case "discontinued":
                    statusValue = "discontinued";
                    break;
                case "not_published":
                    statusValue = "not_published";
                    break;
                default:
                    statusValue = "releasing";
            }
            searchUrl.addQuery("status[]", statusValue);
        }

        const request = { url: searchUrl.build(), method: "GET" };

        const $ = await this.fetchCheerio(request);
        const searchResults: SearchResultItem[] = [];

        $(".original.card-lg .unit .inner").each((_, element) => {
            const unit = $(element);
            const infoLink = unit.find(".info > a");
            const title = infoLink.text().trim();
            const image = unit.find("img").attr("src") || "";
            const mangaId = infoLink.attr("href")?.replace("/manga/", "") || "";
            const latestChapter = unit
                .find(".content[data-name='chap'] a")
                .first()
                .find("span")
                .first()
                .text()
                .trim();
            const latestChapterMatch = latestChapter.match(/Chap (\d+)/);
            const subtitle = latestChapterMatch
                ? `Ch. ${latestChapterMatch[1]}`
                : undefined;

            if (!title || !mangaId) {
                return;
            }

            searchResults.push({
                mangaId: mangaId,
                imageUrl: image,
                title: title,
                subtitle: subtitle,
                metadata: undefined,
            });
        });

        const hasNextPage = !!$(".page-item.active + .page-item .page-link")
            .length;

        return {
            items: searchResults,
            metadata: hasNextPage ? { page: page + 1 } : undefined,
        };
    }

    async getMangaDetails(mangaId: string): Promise<SourceManga> {
        const request = {
            url: new URLBuilder(baseUrl)
                .addPath("manga")
                .addPath(mangaId)
                .build(),
            method: "GET",
        };

        const $ = await this.fetchCheerio(request);

        const title = $(".manga-detail .info h1").text().trim();
        const altTitles = [$(".manga-detail .info h6").text().trim()];
        const image = $(".manga-detail .poster img").attr("src") || "";
        const description = $(".manga-detail .info .description").text().trim();
        const authors: string[] = [];
        $("#info-rating .meta div").each((_, element) => {
            const label = $(element).find("span").first().text().trim();
            if (label === "Author:") {
                $(element)
                    .find("a")
                    .each((_, authorElement) => {
                        authors.push($(authorElement).text().trim());
                    });
            }
        });
        let status = "UNKNOWN";
        const statusText = $(".manga-detail .info .min-info")
            .text()
            .toLowerCase();
        if (statusText.includes("releasing")) {
            status = "ONGOING";
        } else if (statusText.includes("completed")) {
            status = "COMPLETED";
        } else if (
            statusText.includes("hiatus") ||
            statusText.includes("discontinued") ||
            statusText.includes("not yet published")
        ) {
            status = "UNKNOWN";
        }

        const tags: TagSection[] = [];
        const genres: string[] = [];
        let rating = 1;

        $("#info-rating .meta div").each((_, element) => {
            const label = $(element).find("span").first().text().trim();
            if (label === "Genres:") {
                $(element)
                    .find("a")
                    .each((_, genreElement) => {
                        genres.push($(genreElement).text().trim());
                    });
            }
        });

        const ratingValue = $("#info-rating .score .live-score").text().trim();
        if (ratingValue) {
            rating = parseFloat(ratingValue);
        }

        if (genres.length > 0) {
            tags.push({
                id: "genres",
                title: "Genres",
                tags: genres.map((genre) => ({
                    id: genre
                        .toLowerCase()
                        .replace(/\s+/g, "-")
                        .replace(/[^a-z0-9-]/g, ""),
                    title: genre,
                })),
            });
        }

        return {
            mangaId: mangaId,
            mangaInfo: {
                primaryTitle: title,
                secondaryTitles: altTitles,
                thumbnailUrl: image,
                synopsis: description,
                rating: rating,
                contentRating: ContentRating.EVERYONE,
                status: status as "ONGOING" | "COMPLETED" | "UNKNOWN",
                tagGroups: tags,
            },
        };
    }

    async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
        const mangaId = sourceManga.mangaId.split(".")[1];

        const requests = ["read", "manga"].map((type) => ({
            url: new URLBuilder(baseUrl)
                .addPath("ajax")
                .addPath(type)
                .addPath(mangaId)
                .addPath("chapter")
                .addPath("en")
                .build(),
            method: "GET",
        }));

        let buffer1: ArrayBuffer | null = null;
        let buffer2: ArrayBuffer | null = null;
        try {
            [buffer1, buffer2] = await Promise.all(
                requests.map((req) =>
                    Application.scheduleRequest(req).then(
                        ([, buffer]) => buffer,
                    ),
                ),
            );
        } catch (error) {
            console.error("Failed to fetch chapter buffers:", error);
            buffer1 = buffer2 = null;
        }

        let r1: MangaFire.Result | null = null;
        let r2: MangaFire.Result | null = null;
        let $r2: CheerioAPI | undefined;
        let $1: CheerioAPI | undefined;

        if (buffer1) {
            try {
                r1 = JSON.parse(
                    Application.arrayBufferToUTF8String(buffer1),
                ) as MangaFire.Result;
                if (
                    r1?.result &&
                    typeof r1.result !== "string" &&
                    r1.result.html
                ) {
                    $1 = cheerio.load(r1.result.html);
                }
            } catch (error) {
                console.error("Failed to parse buffer1:", error);
            }
        }

        if (buffer2) {
            try {
                r2 = JSON.parse(
                    Application.arrayBufferToUTF8String(buffer2),
                ) as MangaFire.Result;
                const html =
                    typeof r2?.result === "string"
                        ? r2.result
                        : r2?.result?.html || "";

                if (html) {
                    $r2 = cheerio.load(html);
                }
            } catch (error) {
                console.error("Failed to parse buffer2:", error);
            }
        }

        const timestampMap = new Map<string, string>();

        if ($r2) {
            $r2("li").each((_, el) => {
                const li = $r2(el);
                const chapterNumber = li.attr("data-number") || "0";
                const dateText = li.find("span").last().text().trim();
                timestampMap.set(chapterNumber, dateText);
            });
        }

        const chapters: Chapter[] = [];

        if ($1) {
            $1("li").each((_, el) => {
                const li = $1(el);
                const link = li.find("a");
                const chapterNumber = link.attr("data-number") || "0";
                const timestamp = timestampMap.get(chapterNumber);

                chapters.push({
                    chapterId: link.attr("data-id") || "0",
                    title: link.find("span").first().text().trim(),
                    sourceManga,
                    chapNum: parseFloat(String(chapterNumber)),
                    publishDate: timestamp
                        ? new Date(convertToISO8601(timestamp))
                        : new Date(),
                    volume: undefined,
                    langCode: "🇬🇧",
                });
            });
        }

        return chapters;
    }

    async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
        console.log(`Parsing chapter ${chapter.chapterId}`);
        try {
            // Utilizing ajax API
            // Example: https://mangafire.to/ajax/read/chapter/3832635
            const url = new URLBuilder(baseUrl)
                .addPath("ajax")
                .addPath("read")
                .addPath("chapter")
                .addPath(chapter.chapterId)
                .build();

            console.log(url);

            const request: Request = { url, method: "GET" };

            const [_, buffer] = await Application.scheduleRequest(request);
            const json: MangaFire.PageResponse = JSON.parse(
                Application.arrayBufferToUTF8String(buffer),
            ) as MangaFire.PageResponse;

            const pages: string[] = [];
            json.result.images.forEach((value: MangaFire.ImageData) => {
                pages.push(value[0]);
            });
            return {
                mangaId: chapter.sourceManga.mangaId,
                id: chapter.chapterId,
                pages: pages,
            };
        } catch (error) {
            console.error("Error fetching chapter details:", error);
            throw error;
        }
    }

    getMangaShareUrl(mangaId: string): string {
        return `${baseUrl}/manga/${mangaId}`;
    }

    async getUpdatedSectionItems(
        section: DiscoverSection,
        metadata: { page?: number; collectedIds?: string[] } | undefined,
    ): Promise<PagedResults<DiscoverSectionItem>> {
        const page = metadata?.page ?? 1;
        const collectedIds = metadata?.collectedIds ?? [];

        // Example: https://mangafire.to/filter?keyword=&language[]=en&sort=recently_updated&page=1
        const request = {
            url: new URLBuilder(baseUrl)
                .addPath("filter")
                .addQuery("keyword", "")
                .addQuery("language[]", "en")
                .addQuery("sort", "recently_updated")
                .addQuery("page", page.toString())
                .build(),
            method: "GET",
        };

        const $ = await this.fetchCheerio(request);
        const items: DiscoverSectionItem[] = [];

        $(".unit .inner").each((_, element) => {
            const unit = $(element);
            const infoLink = unit.find(".info > a").last();
            const title = infoLink.text().trim();
            const image = unit.find(".poster img").attr("src") || "";
            const mangaId = infoLink.attr("href")?.replace("/manga/", "") || "";
            const latest_chapter = unit
                .find(".content[data-name='chap']")
                .find("a")
                .eq(0)
                .text()
                .trim();
            const latestChapterMatch = latest_chapter.match(/Chap (\d+)/);
            const subtitle = latestChapterMatch
                ? `Ch. ${latestChapterMatch[1]}`
                : undefined;

            const chapterLink = unit
                .find(".content[data-name='chap'] a")
                .first();
            const chapterId = chapterLink.attr("href")?.split("/").pop() || "";

            if (title && mangaId && !collectedIds.includes(mangaId)) {
                collectedIds.push(mangaId);
                items.push({
                    type: "chapterUpdatesCarouselItem",
                    mangaId: mangaId,
                    chapterId: chapterId,
                    imageUrl: image,
                    title: title,
                    subtitle: subtitle,
                    metadata: undefined,
                });
            }
        });

        // Check if there's a next page
        const hasNextPage = !!$(".page-item.active + .page-item .page-link")
            .length;

        return {
            items: items,
            metadata: hasNextPage
                ? { page: page + 1, collectedIds }
                : undefined,
        };
    }

    async getPopularSectionItems(
        section: DiscoverSection,
        metadata: { page?: number; collectedIds?: string[] } | undefined,
    ): Promise<PagedResults<DiscoverSectionItem>> {
        const page = metadata?.page ?? 1;
        const collectedIds = metadata?.collectedIds ?? [];

        const request = {
            url: new URLBuilder(baseUrl)
                .addPath("filter")
                .addQuery("keyword", "")
                .addQuery("language[]", "en")
                .addQuery("sort", "most_viewed")
                .addQuery("page", page.toString())
                .build(),
            method: "GET",
        };

        const $ = await this.fetchCheerio(request);
        const items: DiscoverSectionItem[] = [];

        $(".unit .inner").each((_, element) => {
            const unit = $(element);
            const infoLink = unit.find(".info > a").last();
            const title = infoLink.text().trim();
            const image = unit.find(".poster img").attr("src") || "";
            const mangaId = infoLink.attr("href")?.replace("/manga/", "") || "";

            const latestChapter = unit
                .find(".content[data-name='chap'] a")
                .filter((_, el) => $(el).find("b").text() === "EN")
                .first()
                .find("span")
                .first()
                .text()
                .trim();

            const chapterMatch = latestChapter.match(/Chap (\d+)/);
            const supertitle = chapterMatch ? `Ch. ${chapterMatch[1]}` : "";

            if (title && mangaId && !collectedIds.includes(mangaId)) {
                collectedIds.push(mangaId);
                items.push({
                    type: "featuredCarouselItem",
                    mangaId: mangaId,
                    imageUrl: image,
                    title: title,
                    supertitle: supertitle,
                    metadata: undefined,
                });
            }
        });

        const hasNextPage = !!$(".hpage .r").length;

        return {
            items: items,
            metadata: hasNextPage
                ? { page: page + 1, collectedIds }
                : undefined,
        };
    }

    async getNewMangaSectionItems(
        section: DiscoverSection,
        metadata: { page?: number; collectedIds?: string[] } | undefined,
    ): Promise<PagedResults<DiscoverSectionItem>> {
        const page = metadata?.page ?? 1;
        const collectedIds = metadata?.collectedIds ?? [];

        const request = {
            url: new URLBuilder(baseUrl).addPath("added").build(),
            method: "GET",
        };

        const $ = await this.fetchCheerio(request);
        const items: DiscoverSectionItem[] = [];

        $(".unit .inner").each((_, element) => {
            const unit = $(element);
            const infoLink = unit.find(".info > a").last();
            const title = infoLink.text().trim();
            const image = unit.find(".poster img").attr("src") || "";
            const mangaId = infoLink.attr("href")?.replace("/manga/", "") || "";

            const latestChapter = unit
                .find(".content[data-name='chap'] a")
                .first()
                .find("span")
                .first()
                .text()
                .trim();
            const latestChapterMatch = latestChapter.match(/Chap (\d+)/);
            const subtitle = latestChapterMatch
                ? `Ch. ${latestChapterMatch[1]}`
                : undefined;

            if (title && mangaId && !collectedIds.includes(mangaId)) {
                collectedIds.push(mangaId);
                items.push(
                    createDiscoverSectionItem({
                        id: mangaId,
                        image: image,
                        title: title,
                        subtitle: subtitle,
                        type: "simpleCarouselItem",
                    }),
                );
            }
        });

        // Check if there's a next page
        const hasNextPage = !!$(".page-item.active + .page-item .page-link")
            .length;

        return {
            items: items,
            metadata: hasNextPage
                ? { page: page + 1, collectedIds }
                : undefined,
        };
    }

    async getFilterSection(): Promise<PagedResults<DiscoverSectionItem>> {
        const items = [
            { id: "manhua", name: "Manhua", type: "type" },
            { id: "manhwa", name: "Manhwa", type: "type" },
            { id: "manga", name: "Manga", type: "type" },
            { id: "1", name: "Action", type: "genres" },
            { id: "78", name: "Adventure", type: "genres" },
            { id: "3", name: "Avant Garde", type: "genres" },
            { id: "4", name: "Boys Love", type: "genres" },
            { id: "5", name: "Comedy", type: "genres" },
            { id: "77", name: "Demons", type: "genres" },
            { id: "6", name: "Drama", type: "genres" },
            { id: "7", name: "Ecchi", type: "genres" },
            { id: "79", name: "Fantasy", type: "genres" },
            { id: "9", name: "Girls Love", type: "genres" },
            { id: "10", name: "Gourmet", type: "genres" },
            { id: "11", name: "Harem", type: "genres" },
            { id: "530", name: "Horror", type: "genres" },
            { id: "13", name: "Isekai", type: "genres" },
            { id: "531", name: "Iyashikei", type: "genres" },
            { id: "15", name: "Josei", type: "genres" },
            { id: "532", name: "Kids", type: "genres" },
            { id: "539", name: "Magic", type: "genres" },
            { id: "533", name: "Mahou Shoujo", type: "genres" },
            { id: "534", name: "Martial Arts", type: "genres" },
            { id: "19", name: "Mecha", type: "genres" },
            { id: "535", name: "Military", type: "genres" },
            { id: "21", name: "Music", type: "genres" },
            { id: "22", name: "Mystery", type: "genres" },
            { id: "23", name: "Parody", type: "genres" },
            { id: "536", name: "Psychological", type: "genres" },
            { id: "25", name: "Reverse Harem", type: "genres" },
            { id: "26", name: "Romance", type: "genres" },
            { id: "73", name: "School", type: "genres" },
            { id: "28", name: "Sci-Fi", type: "genres" },
            { id: "537", name: "Seinen", type: "genres" },
            { id: "30", name: "Shoujo", type: "genres" },
            { id: "31", name: "Shounen", type: "genres" },
            { id: "538", name: "Slice of Life", type: "genres" },
            { id: "33", name: "Space", type: "genres" },
            { id: "34", name: "Sports", type: "genres" },
            { id: "75", name: "Super Power", type: "genres" },
            { id: "76", name: "Supernatural", type: "genres" },
            { id: "37", name: "Suspense", type: "genres" },
            { id: "38", name: "Thriller", type: "genres" },
            { id: "39", name: "Vampire", type: "genres" },
        ];

        return {
            items: items.map((item) => ({
                type: "genresCarouselItem",
                searchQuery: {
                    title: "",
                    filters: [
                        {
                            id: item.type,
                            value:
                                item.type === "genres"
                                    ? { [item.id]: "included" }
                                    : item.id,
                        },
                    ],
                },
                name: item.name,
                metadata: undefined,
            })),
            metadata: undefined,
        };
    }

    checkCloudflareStatus(status: number): void {
        if (status == 503 || status == 403) {
            throw new CloudflareError({ url: baseUrl, method: "GET" });
        }
    }

    async fetchCheerio(request: Request): Promise<CheerioAPI> {
        const [response, data] = await Application.scheduleRequest(request);
        this.checkCloudflareStatus(response.status);
        const htmlStr = Application.arrayBufferToUTF8String(data);
        const dom = htmlparser2.parseDocument(htmlStr);
        return cheerio.load(dom);
    }
}

function createDiscoverSectionItem(options: {
    id: string;
    image: string;
    title: string;
    subtitle?: string;
    type: "simpleCarouselItem";
}): DiscoverSectionItem {
    return {
        type: options.type,
        mangaId: options.id,
        imageUrl: options.image,
        title: options.title,
        subtitle: options.subtitle,
        metadata: undefined,
    };
}

function convertToISO8601(dateText: string): string {
    const now = new Date();

    if (!dateText?.trim()) return now.toISOString();

    if (/^yesterday$/i.test(dateText)) {
        now.setDate(now.getDate() - 1);
        return now.toISOString();
    }

    const relativeMatch = dateText.match(
        /(\d+)\s+(second|minute|hour|day)s?\s+ago/i,
    );
    if (relativeMatch) {
        const [_, value, unit] = relativeMatch;
        switch (unit.toLowerCase()) {
            case "second":
                now.setSeconds(now.getSeconds() - +value);
                break;
            case "minute":
                now.setMinutes(now.getMinutes() - +value);
                break;
            case "hour":
                now.setHours(now.getHours() - +value);
                break;
            case "day":
                now.setDate(now.getDate() - +value);
                break;
        }
        return now.toISOString();
    }

    const parsedDate = new Date(dateText);
    return isNaN(parsedDate.getTime())
        ? now.toISOString()
        : parsedDate.toISOString();
}

export const MangaFire = new MangaFireExtension();
