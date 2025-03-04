export const extractError = (error: unknown) => {
  if (error instanceof Error) {
    return {
      message: error.message,
    };
  } else {
    return {
      message: "Unknown error",
    };
  }
};
