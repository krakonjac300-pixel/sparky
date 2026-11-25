// Read committed data when each write runs. A late callback can never publish an older captured score.
export function orderedPhoneScores<T>(read: () => Promise<T>, publish: (score: T, receipts?: string[]) => Promise<void>) {
  let tail = Promise.resolve();
  return (receipts?: string[]) => {
    const write = tail.then(async () => publish(await read(), receipts));
    tail = write.catch(() => {});
    return write;
  };
}
