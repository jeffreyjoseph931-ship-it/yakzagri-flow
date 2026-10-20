import { render, screen, act, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { Toast } from "@/components/ui/Toast";
import { ToastContainer } from "@/components/ui/ToastContainer";
import { ToastProvider, useToast } from "@/hooks/useToast";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";

jest.useFakeTimers();

const wrapper = ({ children }: { children: ReactNode }) => (
  <ToastProvider>{children}</ToastProvider>
);

describe("useToast", () => {
  it("starts with no toasts", () => {
    const { result } = renderHook(() => useToast(), { wrapper });
    expect(result.current.toasts).toHaveLength(0);
  });

  it("adds a toast", () => {
    const { result } = renderHook(() => useToast(), { wrapper });
    act(() => { result.current.addToast({ type: "success", message: "Done" }); });
    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].message).toBe("Done");
  });

  it("sets default duration to 5000ms", () => {
    const { result } = renderHook(() => useToast(), { wrapper });
    act(() => { result.current.addToast({ type: "info", message: "Hello" }); });
    expect(result.current.toasts[0].duration).toBe(5000);
  });

  it("respects custom duration", () => {
    const { result } = renderHook(() => useToast(), { wrapper });
    act(() => { result.current.addToast({ type: "info", message: "Hello", duration: 2000 }); });
    expect(result.current.toasts[0].duration).toBe(2000);
  });

  it("removes a toast by id", () => {
    const { result } = renderHook(() => useToast(), { wrapper });
    act(() => { result.current.addToast({ type: "error", message: "Oops" }); });
    const id = result.current.toasts[0].id;
    act(() => { result.current.removeToast(id); });
    expect(result.current.toasts).toHaveLength(0);
  });

  it("caps visible toasts at 5", () => {
    const { result } = renderHook(() => useToast(), { wrapper });
    act(() => {
      for (let i = 0; i < 8; i++) {
        result.current.addToast({ type: "info", message: `msg ${i}` });
      }
    });
    expect(result.current.toasts).toHaveLength(5);
  });

  it("keeps the newest 5 when capped", () => {
    const { result } = renderHook(() => useToast(), { wrapper });
    act(() => {
      for (let i = 0; i < 7; i++) {
        result.current.addToast({ type: "info", message: `msg ${i}` });
      }
    });
    expect(result.current.toasts[0].message).toBe("msg 2");
    expect(result.current.toasts[4].message).toBe("msg 6");
  });
});

describe("Toast component", () => {
  const onClose = jest.fn();

  beforeEach(() => onClose.mockClear());

  it("renders message and title", () => {
    render(<Toast id="1" type="success" title="Great" message="It worked" onClose={onClose} />);
    expect(screen.getByText("Great")).toBeInTheDocument();
    expect(screen.getByText("It worked")).toBeInTheDocument();
  });

  it("calls onClose when close button clicked", async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<Toast id="1" type="error" message="Oops" onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: /close/i }));
    act(() => jest.advanceTimersByTime(300));
    expect(onClose).toHaveBeenCalledWith("1");
  });

  it("auto-dismisses after duration", async () => {
    render(<Toast id="1" type="warning" message="Watch out" duration={5000} onClose={onClose} />);
    act(() => jest.advanceTimersByTime(5300));
    await waitFor(() => expect(onClose).toHaveBeenCalledWith("1"));
  });

  it("pauses dismissal on hover and resumes with the remaining duration", () => {
    render(<Toast id="1" type="warning" message="Watch out" duration={5000} onClose={onClose} />);
    const toast = screen.getByText("Watch out").closest('[role="group"]')!;

    act(() => jest.advanceTimersByTime(2000));
    fireEvent.mouseEnter(toast);
    act(() => jest.advanceTimersByTime(5000));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.mouseLeave(toast);
    act(() => jest.advanceTimersByTime(2999));
    expect(onClose).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(301));
    expect(onClose).toHaveBeenCalledWith("1");
  });

  it("pauses dismissal while focus stays inside the toast", () => {
    render(<Toast id="1" type="error" message="Please review this error" duration={5000} onClose={onClose} />);
    const closeButton = screen.getByRole("button", { name: /close/i });

    act(() => jest.advanceTimersByTime(2000));
    fireEvent.focus(closeButton);
    act(() => jest.advanceTimersByTime(5000));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.blur(closeButton, { relatedTarget: document.body });
    act(() => jest.advanceTimersByTime(3300));
    expect(onClose).toHaveBeenCalledWith("1");
  });

  it.each([
    ["success", "success"],
    ["error", "error"],
    ["warning", "warning"],
    ["info", "info"],
  ] as const)("renders %s variant", (type) => {
    const { container } = render(
      <Toast id="1" type={type} message="msg" onClose={onClose} />
    );
    expect(container.firstChild).toBeInTheDocument();
  });
});

describe("ToastContainer announcements", () => {
  function Harness({ type, message }: { type?: "success" | "error"; message?: string }) {
    const { addToast } = useToast();
    useEffect(() => {
      if (type && message) addToast({ type, message, duration: 0 });
    }, [addToast, message, type]);
    return <ToastContainer />;
  }

  it("keeps live regions mounted when there are no toasts", () => {
    render(<ToastProvider><ToastContainer /></ToastProvider>);
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByRole("alert")).toHaveAttribute("aria-live", "assertive");
  });

  it("announces errors assertively and other toasts politely", () => {
    const { rerender } = render(<ToastProvider><Harness type="success" message="Saved" /></ToastProvider>);
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
    rerender(<ToastProvider><Harness type="error" message="Could not save" /></ToastProvider>);
    expect(screen.getByRole("alert")).toHaveTextContent("Could not save");
  });
});
