import { generateCursorAuthParams, getTokenExpiry, pollCursorAuth, refreshCursorToken, } from "./auth";
import { getCursorModels } from "./models";
import { startProxy } from "./proxy";
const CURSOR_PROVIDER_ID = "cursor";
/**
 * OpenCode plugin that provides Cursor authentication and model access.
 * Register in opencode.json: { "plugin": ["opencode-cursor-oauth"] }
 */
export const CursorAuthPlugin = async (input) => {
    return {
        auth: {
            provider: CURSOR_PROVIDER_ID,
            async loader(getAuth, provider) {
                const auth = await getAuth();
                if (!auth || auth.type !== "oauth")
                    return {};
                // Ensure we have a valid access token, refreshing if expired
                let accessToken = auth.access;
                if (!accessToken || auth.expires < Date.now()) {
                    const refreshed = await refreshCursorToken(auth.refresh);
                    await input.client.auth.set({
                        path: { id: CURSOR_PROVIDER_ID },
                        body: {
                            type: "oauth",
                            refresh: refreshed.refresh,
                            access: refreshed.access,
                            expires: refreshed.expires,
                        },
                    });
                    accessToken = refreshed.access;
                }
                const models = await getCursorModels(accessToken);
                const port = await startProxy(async () => {
                    const currentAuth = await getAuth();
                    if (currentAuth.type !== "oauth") {
                        throw new Error("Cursor auth not configured");
                    }
                    if (!currentAuth.access || currentAuth.expires < Date.now()) {
                        const refreshed = await refreshCursorToken(currentAuth.refresh);
                        await input.client.auth.set({
                            path: { id: CURSOR_PROVIDER_ID },
                            body: {
                                type: "oauth",
                                refresh: refreshed.refresh,
                                access: refreshed.access,
                                expires: refreshed.expires,
                            },
                        });
                        return refreshed.access;
                    }
                    return currentAuth.access;
                }, models);
                if (provider) {
                    provider.models = buildCursorProviderModels(models, port);
                }
                return {
                    baseURL: `http://localhost:${port}/v1`,
                    apiKey: "cursor-proxy",
                    async fetch(requestInput, init) {
                        if (init?.headers) {
                            if (init.headers instanceof Headers) {
                                init.headers.delete("authorization");
                            }
                            else if (Array.isArray(init.headers)) {
                                init.headers = init.headers.filter(([key]) => key.toLowerCase() !== "authorization");
                            }
                            else {
                                delete init.headers["authorization"];
                                delete init.headers["Authorization"];
                            }
                        }
                        return fetch(requestInput, init);
                    },
                };
            },
            methods: [
                {
                    type: "oauth",
                    label: "Login with Cursor",
                    async authorize() {
                        const { verifier, uuid, loginUrl } = await generateCursorAuthParams();
                        return {
                            url: loginUrl,
                            instructions: "Complete login in your browser. This window will close automatically.",
                            method: "auto",
                            async callback() {
                                const { accessToken, refreshToken } = await pollCursorAuth(uuid, verifier);
                                return {
                                    type: "success",
                                    refresh: refreshToken,
                                    access: accessToken,
                                    expires: getTokenExpiry(accessToken),
                                };
                            },
                        };
                    },
                },
            ],
        },
    };
};
function buildCursorProviderModels(models, port) {
    return Object.fromEntries(models.map((model) => [
        model.id,
        {
            id: model.id,
            providerID: CURSOR_PROVIDER_ID,
            api: {
                id: model.id,
                url: `http://localhost:${port}/v1`,
                npm: "@ai-sdk/openai-compatible",
            },
            name: model.name,
            capabilities: {
                temperature: true,
                reasoning: model.reasoning,
                attachment: false,
                toolcall: true,
                input: {
                    text: true,
                    audio: false,
                    image: false,
                    video: false,
                    pdf: false,
                },
                output: {
                    text: true,
                    audio: false,
                    image: false,
                    video: false,
                    pdf: false,
                },
                interleaved: false,
            },
            cost: {
                input: 0,
                output: 0,
                cache: { read: 0, write: 0 },
            },
            limit: {
                context: model.contextWindow,
                output: model.maxTokens,
            },
            status: "active",
            options: {},
            headers: {},
            release_date: "",
            variants: {},
        },
    ]));
}
export default CursorAuthPlugin;
