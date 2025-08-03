export const formatOutputAmount = (amount: string): string => {
  const num = parseFloat(amount);

  if (num < 0.0000001) {
    return "0.0000001 ";
  } else if (num < 0.000001) {
    const formatted = num.toFixed(10).replace(/\.?0+$/, "");
    return formatted.includes(".") ? formatted : formatted + ".0";
  } else if (num < 0.001) {
    return num.toFixed(8).replace(/\.?0+$/, "");
  } else if (num < 1) {
    return num.toFixed(6);
  } else if (num < 1000) {
    return num.toFixed(4);
  } else {
    return num.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }
};
