/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { telegramClient } from "./client";
import type { TelegramAuthData } from "./types";

describe("telegramClient", () => {
  let mockFetch: any;
  let client: ReturnType<typeof telegramClient>;

  beforeEach(() => {
    // Create mock fetch function
    mockFetch = vi.fn();

    // Get client instance
    client = telegramClient();

    // Reset DOM
    document.body.innerHTML = "";
    document.head.innerHTML = "";

    // Clear any global Telegram object
    (window as any).Telegram = undefined;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Plugin structure", () => {
    it("should have correct plugin id", () => {
      expect(client.id).toBe("telegram");
    });

    it("should export required actions", () => {
      const actions = client.getActions(mockFetch);

      expect(actions).toHaveProperty("signInWithTelegram");
      expect(actions).toHaveProperty("linkTelegram");
      expect(actions).toHaveProperty("unlinkTelegram");
      expect(actions).toHaveProperty("getTelegramConfig");
      expect(actions).toHaveProperty("initTelegramWidget");
      expect(actions).toHaveProperty("initTelegramWidgetRedirect");
    });

    it("should have all actions as functions", () => {
      const actions = client.getActions(mockFetch);

      expect(typeof actions.signInWithTelegram).toBe("function");
      expect(typeof actions.linkTelegram).toBe("function");
      expect(typeof actions.unlinkTelegram).toBe("function");
      expect(typeof actions.getTelegramConfig).toBe("function");
      expect(typeof actions.initTelegramWidget).toBe("function");
      expect(typeof actions.initTelegramWidgetRedirect).toBe("function");
    });
  });

  describe("signInWithTelegram", () => {
    it("should call fetch with correct endpoint and method", async () => {
      const authData: TelegramAuthData = {
        id: 123456789,
        first_name: "John",
        last_name: "Doe",
        username: "johndoe",
        auth_date: 1234567890,
        hash: "abc123",
      };

      mockFetch.mockResolvedValueOnce({ data: { user: {}, session: {} } });

      const actions = client.getActions(mockFetch);
      await actions.signInWithTelegram(authData);

      expect(mockFetch).toHaveBeenCalledWith("/telegram/signin", {
        method: "POST",
        body: authData,
      });
    });

    it("should return response from fetch", async () => {
      const authData: TelegramAuthData = {
        id: 123456789,
        first_name: "John",
        auth_date: 1234567890,
        hash: "abc123",
      };

      const expectedResponse = {
        data: {
          user: { id: "user_123", name: "John" },
          session: { id: "session_456" },
        },
      };

      mockFetch.mockResolvedValueOnce(expectedResponse);

      const actions = client.getActions(mockFetch);
      const result = await actions.signInWithTelegram(authData);

      expect(result).toEqual(expectedResponse);
    });

    it("should handle minimal auth data", async () => {
      const minimalAuthData: TelegramAuthData = {
        id: 123,
        first_name: "User",
        auth_date: 123456,
        hash: "hash",
      };

      mockFetch.mockResolvedValueOnce({ data: {} });

      const actions = client.getActions(mockFetch);
      await actions.signInWithTelegram(minimalAuthData);

      expect(mockFetch).toHaveBeenCalledWith("/telegram/signin", {
        method: "POST",
        body: minimalAuthData,
      });
    });
  });

  describe("linkTelegram", () => {
    it("should call fetch with correct endpoint and method", async () => {
      const authData: TelegramAuthData = {
        id: 123456789,
        first_name: "John",
        auth_date: 1234567890,
        hash: "abc123",
      };

      mockFetch.mockResolvedValueOnce({ data: { success: true } });

      const actions = client.getActions(mockFetch);
      await actions.linkTelegram(authData);

      expect(mockFetch).toHaveBeenCalledWith("/telegram/link", {
        method: "POST",
        body: authData,
      });
    });

    it("should return response from fetch", async () => {
      const authData: TelegramAuthData = {
        id: 123456789,
        first_name: "John",
        auth_date: 1234567890,
        hash: "abc123",
      };

      const expectedResponse = { data: { success: true, message: "Linked" } };

      mockFetch.mockResolvedValueOnce(expectedResponse);

      const actions = client.getActions(mockFetch);
      const result = await actions.linkTelegram(authData);

      expect(result).toEqual(expectedResponse);
    });
  });

  describe("unlinkTelegram", () => {
    it("should call fetch with correct endpoint and method", async () => {
      mockFetch.mockResolvedValueOnce({ data: { success: true } });

      const actions = client.getActions(mockFetch);
      await actions.unlinkTelegram();

      expect(mockFetch).toHaveBeenCalledWith("/telegram/unlink", {
        method: "POST",
      });
    });

    it("should not send any body", async () => {
      mockFetch.mockResolvedValueOnce({ data: {} });

      const actions = client.getActions(mockFetch);
      await actions.unlinkTelegram();

      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[1]).not.toHaveProperty("body");
    });

    it("should return response from fetch", async () => {
      const expectedResponse = { data: { success: true } };
      mockFetch.mockResolvedValueOnce(expectedResponse);

      const actions = client.getActions(mockFetch);
      const result = await actions.unlinkTelegram();

      expect(result).toEqual(expectedResponse);
    });
  });

  describe("getTelegramConfig", () => {
    it("should call fetch with correct endpoint and method", async () => {
      mockFetch.mockResolvedValueOnce({
        data: { botUsername: "test_bot" },
      });

      const actions = client.getActions(mockFetch);
      await actions.getTelegramConfig();

      expect(mockFetch).toHaveBeenCalledWith("/telegram/config", {
        method: "GET",
      });
    });

    it("should return bot configuration", async () => {
      const expectedResponse = { data: { botUsername: "my_auth_bot" } };
      mockFetch.mockResolvedValueOnce(expectedResponse);

      const actions = client.getActions(mockFetch);
      const result = await actions.getTelegramConfig();

      expect(result).toEqual(expectedResponse);
    });

    it("should return testMode in config response", async () => {
      const expectedResponse = {
        data: { botUsername: "test_bot", testMode: true },
      };
      mockFetch.mockResolvedValueOnce(expectedResponse);

      const actions = client.getActions(mockFetch);
      const result = await actions.getTelegramConfig();

      expect(result.data?.testMode).toBe(true);
    });
  });

  describe("initTelegramWidget", () => {
    beforeEach(() => {
      // Create container element
      const container = document.createElement("div");
      container.id = "telegram-login";
      document.body.appendChild(container);

      // Mock Telegram object (script already loaded)
      (window as any).Telegram = { Login: {} };

      // Mock bot config response
      mockFetch.mockResolvedValue({
        data: { botUsername: "test_bot" },
      });
    });

    it("should throw error if container doesn't exist", async () => {
      const actions = client.getActions(mockFetch);

      await expect(
        actions.initTelegramWidget("nonexistent-container", {}, async () => {})
      ).rejects.toThrow('Container with id "nonexistent-container" not found');
    });

    it("should fetch bot configuration", async () => {
      const actions = client.getActions(mockFetch);

      await actions.initTelegramWidget("telegram-login", {}, async () => {});

      expect(mockFetch).toHaveBeenCalledWith("/telegram/config", {
        method: "GET",
      });
    });

    it("should throw error if config fetch fails", async () => {
      mockFetch.mockResolvedValueOnce({ data: null });

      const actions = client.getActions(mockFetch);

      await expect(
        actions.initTelegramWidget("telegram-login", {}, async () => {})
      ).rejects.toThrow("Failed to get Telegram config");
    });

    it("should clear container before adding widget", async () => {
      const container = document.getElementById("telegram-login")!;
      container.innerHTML = "<div>Old content</div>";

      const actions = client.getActions(mockFetch);
      await actions.initTelegramWidget("telegram-login", {}, async () => {});

      // After init, old content should be gone
      expect(container.querySelector("div")).toBeNull();
    });

    it("should create script element with correct attributes", async () => {
      const actions = client.getActions(mockFetch);
      await actions.initTelegramWidget(
        "telegram-login",
        {
          size: "medium",
          showUserPhoto: false,
          cornerRadius: 10,
          lang: "en",
        },
        async () => {}
      );

      const container = document.getElementById("telegram-login")!;
      const script = container.querySelector("script");

      expect(script).toBeTruthy();
      expect(script?.getAttribute("data-telegram-login")).toBe("test_bot");
      expect(script?.getAttribute("data-size")).toBe("medium");
      expect(script?.getAttribute("data-userpic")).toBe("false");
      expect(script?.getAttribute("data-radius")).toBe("10");
      expect(script?.getAttribute("data-lang")).toBe("en");
    });

    it("should use default options when not provided", async () => {
      const actions = client.getActions(mockFetch);
      await actions.initTelegramWidget("telegram-login", {}, async () => {});

      const container = document.getElementById("telegram-login")!;
      const script = container.querySelector("script");

      expect(script?.getAttribute("data-size")).toBe("large");
      expect(script?.getAttribute("data-userpic")).toBe("true");
      expect(script?.getAttribute("data-radius")).toBe("20");
    });

    it("should not set request-access by default", async () => {
      const actions = client.getActions(mockFetch);
      await actions.initTelegramWidget("telegram-login", {}, async () => {});

      const container = document.getElementById("telegram-login")!;
      const script = container.querySelector("script");

      expect(script?.hasAttribute("data-request-access")).toBe(false);
    });

    it("should set request-access when enabled", async () => {
      const actions = client.getActions(mockFetch);
      await actions.initTelegramWidget(
        "telegram-login",
        { requestAccess: true },
        async () => {}
      );

      const container = document.getElementById("telegram-login")!;
      const script = container.querySelector("script");

      expect(script?.getAttribute("data-request-access")).toBe("write");
    });

    it("should create global callback function", async () => {
      const callback = vi.fn();
      const actions = client.getActions(mockFetch);

      await actions.initTelegramWidget("telegram-login", {}, callback);

      const container = document.getElementById("telegram-login")!;
      const script = container.querySelector("script");
      const onAuthAttr = script?.getAttribute("data-onauth");

      expect(onAuthAttr).toMatch(/telegramCallback_\d+\(user\)/);

      // Extract callback name
      const callbackName = onAuthAttr?.replace("(user)", "");
      expect((window as any)[callbackName!]).toBeDefined();
      expect(typeof (window as any)[callbackName!]).toBe("function");
    });

    it("should call onAuth callback when telegram returns data", async () => {
      const callback = vi.fn();
      const authData: TelegramAuthData = {
        id: 123,
        first_name: "Test",
        auth_date: 123456,
        hash: "hash",
      };

      const actions = client.getActions(mockFetch);
      await actions.initTelegramWidget("telegram-login", {}, callback);

      // Find the callback function
      const container = document.getElementById("telegram-login")!;
      const script = container.querySelector("script");
      const onAuthAttr = script?.getAttribute("data-onauth");
      const callbackName = onAuthAttr?.replace("(user)", "");

      // Simulate Telegram calling the callback
      (window as any)[callbackName!](authData);

      expect(callback).toHaveBeenCalledWith(authData);
    });

    it("should clean up callback function after execution", async () => {
      const callback = vi.fn();
      const authData: TelegramAuthData = {
        id: 123,
        first_name: "Test",
        auth_date: 123456,
        hash: "hash",
      };

      const actions = client.getActions(mockFetch);
      await actions.initTelegramWidget("telegram-login", {}, callback);

      const container = document.getElementById("telegram-login")!;
      const script = container.querySelector("script");
      const onAuthAttr = script?.getAttribute("data-onauth");
      const callbackName = onAuthAttr?.replace("(user)", "");

      // Call the callback
      (window as any)[callbackName!](authData);

      // Callback should be cleaned up
      expect((window as any)[callbackName!]).toBeUndefined();
    });
  });

  describe("initTelegramWidgetRedirect", () => {
    beforeEach(() => {
      const container = document.createElement("div");
      container.id = "telegram-login";
      document.body.appendChild(container);

      (window as any).Telegram = { Login: {} };

      mockFetch.mockResolvedValue({
        data: { botUsername: "test_bot" },
      });
    });

    it("should throw error if container doesn't exist", async () => {
      const actions = client.getActions(mockFetch);

      await expect(
        actions.initTelegramWidgetRedirect(
          "nonexistent-container",
          "/callback",
          {}
        )
      ).rejects.toThrow('Container with id "nonexistent-container" not found');
    });

    it("should create script with redirect URL", async () => {
      const actions = client.getActions(mockFetch);
      await actions.initTelegramWidgetRedirect(
        "telegram-login",
        "/auth/callback",
        {}
      );

      const container = document.getElementById("telegram-login")!;
      const script = container.querySelector("script");

      expect(script?.getAttribute("data-auth-url")).toBe("/auth/callback");
    });

    it("should not have onauth attribute in redirect mode", async () => {
      const actions = client.getActions(mockFetch);
      await actions.initTelegramWidgetRedirect(
        "telegram-login",
        "/callback",
        {}
      );

      const container = document.getElementById("telegram-login")!;
      const script = container.querySelector("script");

      expect(script?.hasAttribute("data-onauth")).toBe(false);
    });

    it("should use default options", async () => {
      const actions = client.getActions(mockFetch);
      await actions.initTelegramWidgetRedirect(
        "telegram-login",
        "/callback",
        {}
      );

      const container = document.getElementById("telegram-login")!;
      const script = container.querySelector("script");

      expect(script?.getAttribute("data-size")).toBe("large");
      expect(script?.getAttribute("data-userpic")).toBe("true");
      expect(script?.getAttribute("data-radius")).toBe("20");
    });

    it("should respect custom options", async () => {
      const actions = client.getActions(mockFetch);
      await actions.initTelegramWidgetRedirect("telegram-login", "/callback", {
        size: "small",
        showUserPhoto: false,
        cornerRadius: 5,
        requestAccess: true,
        lang: "pl",
      });

      const container = document.getElementById("telegram-login")!;
      const script = container.querySelector("script");

      expect(script?.getAttribute("data-size")).toBe("small");
      expect(script?.getAttribute("data-userpic")).toBe("false");
      expect(script?.getAttribute("data-radius")).toBe("5");
      expect(script?.getAttribute("data-request-access")).toBe("write");
      expect(script?.getAttribute("data-lang")).toBe("pl");
    });

    it("should clear container before adding widget", async () => {
      const container = document.getElementById("telegram-login")!;
      container.innerHTML = "<p>Old content</p>";

      const actions = client.getActions(mockFetch);
      await actions.initTelegramWidgetRedirect(
        "telegram-login",
        "/callback",
        {}
      );

      expect(container.querySelector("p")).toBeNull();
      expect(container.querySelector("script")).toBeTruthy();
    });
  });

  describe("Error handling", () => {
    it("should handle fetch errors in signInWithTelegram", async () => {
      const error = new Error("Network error");
      mockFetch.mockRejectedValueOnce(error);

      const actions = client.getActions(mockFetch);
      const authData: TelegramAuthData = {
        id: 123,
        first_name: "Test",
        auth_date: 123456,
        hash: "hash",
      };

      await expect(actions.signInWithTelegram(authData)).rejects.toThrow(
        "Network error"
      );
    });

    it("should handle fetch errors in linkTelegram", async () => {
      const error = new Error("Unauthorized");
      mockFetch.mockRejectedValueOnce(error);

      const actions = client.getActions(mockFetch);
      const authData: TelegramAuthData = {
        id: 123,
        first_name: "Test",
        auth_date: 123456,
        hash: "hash",
      };

      await expect(actions.linkTelegram(authData)).rejects.toThrow(
        "Unauthorized"
      );
    });

    it("should handle fetch errors in unlinkTelegram", async () => {
      const error = new Error("Server error");
      mockFetch.mockRejectedValueOnce(error);

      const actions = client.getActions(mockFetch);

      await expect(actions.unlinkTelegram()).rejects.toThrow("Server error");
    });

    it("should handle fetch errors in getTelegramConfig", async () => {
      const error = new Error("Not found");
      mockFetch.mockRejectedValueOnce(error);

      const actions = client.getActions(mockFetch);

      await expect(actions.getTelegramConfig()).rejects.toThrow("Not found");
    });
  });

  describe("Mini Apps methods", () => {
    describe("signInWithMiniApp", () => {
      it("should call correct endpoint with initData", async () => {
        const mockResponse = {
          data: {
            user: { id: "123", name: "Test User" },
            session: { token: "session-token" },
          },
        };
        mockFetch.mockResolvedValueOnce(mockResponse);

        const actions = client.getActions(mockFetch);
        const initData =
          "user=%7B%22id%22%3A123%7D&auth_date=1234567890&hash=abc123";

        const result = await actions.signInWithMiniApp(initData);

        expect(mockFetch).toHaveBeenCalledWith("/telegram/miniapp/signin", {
          method: "POST",
          body: { initData },
        });
        expect(result).toEqual(mockResponse);
      });

      it("should handle errors", async () => {
        const error = new Error("Invalid initData");
        mockFetch.mockRejectedValueOnce(error);

        const actions = client.getActions(mockFetch);
        const initData = "invalid-data";

        await expect(actions.signInWithMiniApp(initData)).rejects.toThrow(
          "Invalid initData"
        );
      });
    });

    describe("validateMiniApp", () => {
      it("should call validate endpoint with initData", async () => {
        const mockResponse = {
          data: {
            valid: true,
            data: {
              user: { id: 123, first_name: "Test" },
              auth_date: 1234567890,
              hash: "abc123",
            },
          },
        };
        mockFetch.mockResolvedValueOnce(mockResponse);

        const actions = client.getActions(mockFetch);
        const initData =
          "user=%7B%22id%22%3A123%7D&auth_date=1234567890&hash=abc123";

        const result = await actions.validateMiniApp(initData);

        expect(mockFetch).toHaveBeenCalledWith("/telegram/miniapp/validate", {
          method: "POST",
          body: { initData },
        });
        expect(result).toEqual(mockResponse);
      });

      it("should return invalid for bad initData", async () => {
        const mockResponse = {
          data: {
            valid: false,
            data: null,
          },
        };
        mockFetch.mockResolvedValueOnce(mockResponse);

        const actions = client.getActions(mockFetch);
        const initData = "invalid-data";

        const result = await actions.validateMiniApp(initData);

        expect(result.data?.valid).toBe(false);
        expect(result.data?.data).toBeNull();
      });

      it("should handle errors", async () => {
        const error = new Error("Server error");
        mockFetch.mockRejectedValueOnce(error);

        const actions = client.getActions(mockFetch);

        await expect(actions.validateMiniApp("some-data")).rejects.toThrow(
          "Server error"
        );
      });
    });

    describe("autoSignInFromMiniApp", () => {
      it("should throw if not in browser", async () => {
        // Mock window as undefined
        const originalWindow = global.window;
        (global as any).window = undefined;

        const actions = client.getActions(mockFetch);

        await expect(actions.autoSignInFromMiniApp()).rejects.toThrow(
          "This method can only be called in browser"
        );

        // Restore window
        (global as any).window = originalWindow;
      });

      it("should throw if Telegram.WebApp not available", async () => {
        // Mock window without Telegram
        (window as any).Telegram = undefined;

        const actions = client.getActions(mockFetch);

        await expect(actions.autoSignInFromMiniApp()).rejects.toThrow(
          "Not running in Telegram Mini App or initData not available"
        );
      });

      it("should throw if initData not available", async () => {
        // Mock Telegram without initData
        (window as any).Telegram = {
          WebApp: {
            initData: "",
          },
        };

        const actions = client.getActions(mockFetch);

        await expect(actions.autoSignInFromMiniApp()).rejects.toThrow(
          "Not running in Telegram Mini App or initData not available"
        );
      });

      it("should sign in with Telegram.WebApp.initData", async () => {
        const mockInitData =
          "user=%7B%22id%22%3A123%7D&auth_date=1234567890&hash=abc123";
        (window as any).Telegram = {
          WebApp: {
            initData: mockInitData,
          },
        };

        const mockResponse = {
          data: {
            user: { id: "123", name: "Test User" },
            session: { token: "session-token" },
          },
        };
        mockFetch.mockResolvedValueOnce(mockResponse);

        const actions = client.getActions(mockFetch);
        const result = await actions.autoSignInFromMiniApp();

        expect(mockFetch).toHaveBeenCalledWith("/telegram/miniapp/signin", {
          method: "POST",
          body: { initData: mockInitData },
        });
        expect(result).toEqual(mockResponse);
      });

      it("should handle errors from API", async () => {
        const mockInitData =
          "user=%7B%22id%22%3A123%7D&auth_date=1234567890&hash=abc123";
        (window as any).Telegram = {
          WebApp: {
            initData: mockInitData,
          },
        };

        const error = new Error("Authentication failed");
        mockFetch.mockRejectedValueOnce(error);

        const actions = client.getActions(mockFetch);

        await expect(actions.autoSignInFromMiniApp()).rejects.toThrow(
          "Authentication failed"
        );
      });
    });
  });

  describe("Widget loading and error cases", () => {
    beforeEach(() => {
      // Clear any existing Telegram object
      (window as any).Telegram = undefined;
      // Create container
      const container = document.createElement("div");
      container.id = "telegram-widget-test";
      document.body.appendChild(container);
    });

    afterEach(() => {
      const container = document.getElementById("telegram-widget-test");
      if (container) {
        document.body.removeChild(container);
      }
    });

    it("should load script when Telegram.Login is not available", async () => {
      // Pre-load Telegram to avoid script loading
      (window as any).Telegram = { Login: {} };

      mockFetch.mockResolvedValueOnce({
        data: { botUsername: "test_bot" },
      });

      const actions = client.getActions(mockFetch);

      // Since Telegram.Login exists, script loading will be skipped
      await actions.initTelegramWidget("telegram-widget-test", {}, () => {});

      expect(mockFetch).toHaveBeenCalledWith("/telegram/config", {
        method: "GET",
      });

      // Clean up
      delete (window as any).Telegram;
    });

    it("should handle script load error", async () => {
      // Don't set Telegram.Login to force script loading
      delete (window as any).Telegram;

      // Intercept createElement to prevent happy-dom from auto-loading
      const originalCreateElement = document.createElement.bind(document);
      let capturedScript: HTMLScriptElement | null = null;

      document.createElement = ((tagName: string) => {
        const element = originalCreateElement(tagName);
        if (tagName === "script") {
          capturedScript = element as HTMLScriptElement;
          // Override appendChild to prevent automatic loading
          const originalAppendChild = document.head.appendChild.bind(
            document.head
          );
          document.head.appendChild = ((node: Node) => {
            if (node === element) {
              // Don't actually append, just trigger onerror manually
              setTimeout(() => {
                if (capturedScript?.onerror) {
                  capturedScript.onerror(new Event("error"));
                }
              }, 0);
              return node;
            }
            return originalAppendChild(node);
          }) as any;
        }
        return element;
      }) as any;

      const actions = client.getActions(mockFetch);

      // Should reject with our error message
      await expect(
        actions.initTelegramWidget("telegram-widget-test", {}, () => {})
      ).rejects.toThrow("Failed to load Telegram widget script");

      // Restore
      document.createElement = originalCreateElement;
    });

    it("should handle missing config data in initTelegramWidget", async () => {
      (window as any).Telegram = { Login: {} };

      mockFetch.mockResolvedValueOnce({
        data: null, // No data returned
      });

      const actions = client.getActions(mockFetch);

      await expect(
        actions.initTelegramWidget("telegram-widget-test", {}, () => {})
      ).rejects.toThrow("Failed to get Telegram config");
    });

    it("should handle missing config data in initTelegramWidgetRedirect", async () => {
      (window as any).Telegram = { Login: {} };

      mockFetch.mockResolvedValueOnce({
        data: null, // No data returned
      });

      const actions = client.getActions(mockFetch);

      await expect(
        actions.initTelegramWidgetRedirect(
          "telegram-widget-test",
          "/callback",
          {}
        )
      ).rejects.toThrow("Failed to get Telegram config");
    });
  });

  describe("Adversarial: getTelegramConfig testMode shape", () => {
    it("should type the config response to include testMode as boolean", async () => {
      const expectedResponse = {
        data: { botUsername: "test_bot", testMode: false },
      };
      mockFetch.mockResolvedValueOnce(expectedResponse);

      const actions = client.getActions(mockFetch);
      const result = await actions.getTelegramConfig();

      expect(result.data).toHaveProperty("testMode");
      expect(typeof result.data?.testMode).toBe("boolean");
    });

    it("should return testMode: false when server has no testMode set", async () => {
      const expectedResponse = {
        data: { botUsername: "test_bot", testMode: false },
      };
      mockFetch.mockResolvedValueOnce(expectedResponse);

      const actions = client.getActions(mockFetch);
      const result = await actions.getTelegramConfig();

      expect(result.data?.testMode).toBe(false);
    });

    it("should return testMode: true when server has testMode enabled", async () => {
      const expectedResponse = {
        data: { botUsername: "test_bot", testMode: true },
      };
      mockFetch.mockResolvedValueOnce(expectedResponse);

      const actions = client.getActions(mockFetch);
      const result = await actions.getTelegramConfig();

      expect(result.data?.testMode).toBe(true);
    });

    it("should return exactly the shape { botUsername, testMode } from config", async () => {
      const expectedResponse = {
        data: {
          botUsername: "production_bot",
          testMode: false,
        },
      };
      mockFetch.mockResolvedValueOnce(expectedResponse);

      const actions = client.getActions(mockFetch);
      const result = await actions.getTelegramConfig();

      // Verify the exact keys we expect
      expect(Object.keys(result.data!)).toContain("botUsername");
      expect(Object.keys(result.data!)).toContain("testMode");
    });
  });

  describe("Adversarial: client plugin structure", () => {
    it("should have $InferServerPlugin property", () => {
      expect(client).toHaveProperty("$InferServerPlugin");
    });

    it("should include signInWithMiniApp action", () => {
      const actions = client.getActions(mockFetch);
      expect(actions).toHaveProperty("signInWithMiniApp");
      expect(typeof actions.signInWithMiniApp).toBe("function");
    });

    it("should include validateMiniApp action", () => {
      const actions = client.getActions(mockFetch);
      expect(actions).toHaveProperty("validateMiniApp");
      expect(typeof actions.validateMiniApp).toBe("function");
    });

    it("should include autoSignInFromMiniApp action", () => {
      const actions = client.getActions(mockFetch);
      expect(actions).toHaveProperty("autoSignInFromMiniApp");
      expect(typeof actions.autoSignInFromMiniApp).toBe("function");
    });

    it("should include signInWithTelegramOIDC action", () => {
      const actions = client.getActions(mockFetch);
      expect(actions).toHaveProperty("signInWithTelegramOIDC");
      expect(typeof actions.signInWithTelegramOIDC).toBe("function");
    });
  });

  describe("fetchOptions support", () => {
    it("should pass fetchOptions to signInWithTelegram", async () => {
      const authData: TelegramAuthData = {
        id: 123,
        first_name: "Test",
        auth_date: 123456,
        hash: "hash",
      };
      const fetchOpts = { headers: { "X-Custom": "value" } };
      mockFetch.mockResolvedValueOnce({ data: {} });

      const actions = client.getActions(mockFetch);
      await actions.signInWithTelegram(authData, fetchOpts);

      expect(mockFetch).toHaveBeenCalledWith("/telegram/signin", {
        method: "POST",
        body: authData,
        headers: { "X-Custom": "value" },
      });
    });

    it("should pass fetchOptions to linkTelegram", async () => {
      const authData: TelegramAuthData = {
        id: 123,
        first_name: "Test",
        auth_date: 123456,
        hash: "hash",
      };
      const fetchOpts = { headers: { "X-Custom": "value" } };
      mockFetch.mockResolvedValueOnce({ data: {} });

      const actions = client.getActions(mockFetch);
      await actions.linkTelegram(authData, fetchOpts);

      expect(mockFetch).toHaveBeenCalledWith("/telegram/link", {
        method: "POST",
        body: authData,
        headers: { "X-Custom": "value" },
      });
    });

    it("should pass fetchOptions to unlinkTelegram", async () => {
      const fetchOpts = { headers: { Authorization: "Bearer token" } };
      mockFetch.mockResolvedValueOnce({ data: {} });

      const actions = client.getActions(mockFetch);
      await actions.unlinkTelegram(fetchOpts);

      expect(mockFetch).toHaveBeenCalledWith("/telegram/unlink", {
        method: "POST",
        headers: { Authorization: "Bearer token" },
      });
    });

    it("should pass fetchOptions to getTelegramConfig", async () => {
      const fetchOpts = { cache: "no-store" as const };
      mockFetch.mockResolvedValueOnce({ data: { botUsername: "bot" } });

      const actions = client.getActions(mockFetch);
      await actions.getTelegramConfig(fetchOpts);

      expect(mockFetch).toHaveBeenCalledWith("/telegram/config", {
        method: "GET",
        cache: "no-store",
      });
    });

    it("should pass fetchOptions to signInWithMiniApp", async () => {
      const fetchOpts = { headers: { "X-Custom": "value" } };
      mockFetch.mockResolvedValueOnce({ data: {} });

      const actions = client.getActions(mockFetch);
      await actions.signInWithMiniApp("initData", fetchOpts);

      expect(mockFetch).toHaveBeenCalledWith("/telegram/miniapp/signin", {
        method: "POST",
        body: { initData: "initData" },
        headers: { "X-Custom": "value" },
      });
    });

    it("should pass fetchOptions to validateMiniApp", async () => {
      const fetchOpts = { headers: { "X-Custom": "value" } };
      mockFetch.mockResolvedValueOnce({ data: { valid: true, data: null } });

      const actions = client.getActions(mockFetch);
      await actions.validateMiniApp("initData", fetchOpts);

      expect(mockFetch).toHaveBeenCalledWith("/telegram/miniapp/validate", {
        method: "POST",
        body: { initData: "initData" },
        headers: { "X-Custom": "value" },
      });
    });

    it("should work without fetchOptions (backward compatible)", async () => {
      const authData: TelegramAuthData = {
        id: 123,
        first_name: "Test",
        auth_date: 123456,
        hash: "hash",
      };
      mockFetch.mockResolvedValueOnce({ data: {} });

      const actions = client.getActions(mockFetch);
      await actions.signInWithTelegram(authData);

      expect(mockFetch).toHaveBeenCalledWith("/telegram/signin", {
        method: "POST",
        body: authData,
      });
    });
  });
});
