import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n/I18nProvider";
import { ResourcesCenter } from "./ResourcesCenter";

const {
  listResources,
  saveResource,
  setResourceEnabled,
  deleteResource,
  importResource,
  exportResource,
} = vi.hoisted(() => ({
  listResources: vi.fn(),
  saveResource: vi.fn(),
  setResourceEnabled: vi.fn(),
  deleteResource: vi.fn(),
  importResource: vi.fn(),
  exportResource: vi.fn(),
}));

vi.mock("../../platform/tauri/bridge", () => ({
  listResources,
  saveResource,
  setResourceEnabled,
  deleteResource,
  importResource,
  exportResource,
}));

const skill = {
  id: "skill-1",
  name: "review-code",
  kind: "skill",
  description: "Review code",
  content: "Always review.",
  enabled: false,
  scope: "global",
  createdAt: 1,
  updatedAt: 1,
};

function renderCenter() {
  return render(
    <I18nProvider>
      <ResourcesCenter />
    </I18nProvider>,
  );
}

describe("ResourcesCenter", () => {
  it("lists resources and shows the skills tab by default", async () => {
    listResources.mockResolvedValue([skill]);
    renderCenter();

    expect(await screen.findByText("review-code")).toBeDefined();
    expect(screen.getByText("Review code")).toBeDefined();
  });

  it("toggles enablement from the card", async () => {
    listResources.mockResolvedValue([skill]);
    setResourceEnabled.mockResolvedValue({ ...skill, enabled: true });
    renderCenter();

    const toggle = (await screen.findByText("review-code"))
      .closest(".resource-card")
      ?.querySelector("input[type=checkbox]") as HTMLInputElement;
    fireEvent.click(toggle);

    await waitFor(() =>
      expect(setResourceEnabled).toHaveBeenCalledWith("skill-1", true),
    );
  });

  it("opens the new-resource form and saves", async () => {
    listResources.mockResolvedValue([]);
    saveResource.mockResolvedValue({ ...skill, id: "skill-2", name: "new-skill" });
    const { container } = renderCenter();

    fireEvent.click(await screen.findByText(/New|新建/));
    const nameInput = screen.getByPlaceholderText("my-skill");
    fireEvent.change(nameInput, { target: { value: "new-skill" } });
    const content = container.querySelector(
      ".resource-form__content",
    ) as HTMLTextAreaElement;
    fireEvent.change(content, { target: { value: "Do the thing." } });

    fireEvent.click(screen.getByText(/Save|保存/));
    await waitFor(() =>
      expect(saveResource).toHaveBeenCalledWith(
        expect.objectContaining({ name: "new-skill", content: "Do the thing." }),
      ),
    );
  });
});
