import { withRetry } from "../utils/retry";

const noSleep = async () => {};

describe("withRetry", () => {
  it("retorna o resultado na primeira tentativa quando não há erro", async () => {
    const fn = jest.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, 3, 0, undefined, noSleep);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retenta e retorna na segunda tentativa", async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(new Error("falha 1"))
      .mockResolvedValueOnce("ok na 2ª");
    const result = await withRetry(fn, 3, 0, undefined, noSleep);
    expect(result).toBe("ok na 2ª");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("tenta maxAttempts vezes e lança o último erro", async () => {
    const fn = jest.fn().mockRejectedValue(new Error("sempre falha"));
    await expect(withRetry(fn, 3, 0, undefined, noSleep)).rejects.toThrow("sempre falha");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("chama onRetry com número da tentativa e erro", async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(new Error("err1"))
      .mockResolvedValueOnce("ok");
    const onRetry = jest.fn();
    await withRetry(fn, 3, 0, onRetry, noSleep);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error));
  });

  it("aplica backoff exponencial no sleep", async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(new Error("err1"))
      .mockRejectedValueOnce(new Error("err2"))
      .mockResolvedValueOnce("ok");
    const sleepMock = jest.fn().mockResolvedValue(undefined);
    await withRetry(fn, 3, 100, undefined, sleepMock);
    expect(sleepMock).toHaveBeenCalledTimes(2);
    expect(sleepMock).toHaveBeenNthCalledWith(1, 100);  // 100 * 2^0
    expect(sleepMock).toHaveBeenNthCalledWith(2, 200);  // 100 * 2^1
  });

  it("não chama sleep após a última tentativa falhar", async () => {
    const fn = jest.fn().mockRejectedValue(new Error("falha"));
    const sleepMock = jest.fn().mockResolvedValue(undefined);
    await expect(withRetry(fn, 2, 100, undefined, sleepMock)).rejects.toThrow();
    expect(sleepMock).toHaveBeenCalledTimes(1); // apenas entre tentativa 1 e 2
  });

  it("usa o sleep padrão (setTimeout) quando não fornecido", async () => {
    jest.useFakeTimers();
    const fn = jest.fn()
      .mockRejectedValueOnce(new Error("err"))
      .mockResolvedValueOnce("ok");

    const promise = withRetry(fn, 2, 50);
    await jest.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe("ok");
    jest.useRealTimers();
  });
});
