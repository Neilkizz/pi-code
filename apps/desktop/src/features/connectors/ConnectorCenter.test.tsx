import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n/I18nProvider";
import { ConnectorCenter } from "./ConnectorCenter";

const {
  listConnectors,
  saveConnector,
  setConnectorEnabled,
  deleteConnector,
  testConnector,
} = vi.hoisted(() => ({
  listConnectors: vi.fn(),
  saveConnector: vi.fn(),
  setConnectorEnabled: vi.fn(),
  deleteConnector: vi.fn(),
  testConnector: vi.fn(),
}));

vi.mock("../../platform/tauri/bridge", () => ({
  listConnectors,
  saveConnector,
  setConnectorEnabled,
  deleteConnector,
  testConnector,
}));

const connector = {
  id: "connector-1",
  name: "filesystem",
  transport: "stdio",
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-filesystem"],
  env: {},
  enabled: false,
  approved: true,
  contentHash: "abc123",
  credentialRef: undefined,
  createdAt: 1,
  updatedAt: 1,
};

function renderConnectors() {
  return render(
    <I18nProvider>
      <ConnectorCenter />
    </I18nProvider>,
  );
}

describe("ConnectorCenter", () => {
  it("renders the connector list", async () => {
    listConnectors.mockResolvedValue([connector]);
    renderConnectors();

    expect(await screen.findByText("filesystem")).toBeDefined();
    expect(screen.getByText("Disabled")).toBeDefined();
  });

  it("toggles a connector enabled state", async () => {
    listConnectors.mockResolvedValue([connector]);
    setConnectorEnabled.mockResolvedValue({ ...connector, enabled: true });
    renderConnectors();

    const checkbox = (await screen.findByRole("checkbox")) as HTMLInputElement;
    fireEvent.click(checkbox);
    await waitFor(() =>
      expect(setConnectorEnabled).toHaveBeenCalledWith("connector-1", true),
    );
  });

  it("opens the new-connector form and saves", async () => {
    listConnectors.mockResolvedValue([]);
    saveConnector.mockResolvedValue({
      ...connector,
      id: "connector-2",
      name: "echo",
      command: "/bin/echo",
      enabled: true,
    });
    renderConnectors();

    fireEvent.click(await screen.findByText("New connector"));
    fireEvent.change(screen.getByPlaceholderText("filesystem"), {
      target: { value: "echo" },
    });
    fireEvent.change(screen.getByPlaceholderText("npx"), {
      target: { value: "/bin/echo" },
    });
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() =>
      expect(saveConnector).toHaveBeenCalledWith(
        expect.objectContaining({ name: "echo", command: "/bin/echo" }),
      ),
    );
  });
});
