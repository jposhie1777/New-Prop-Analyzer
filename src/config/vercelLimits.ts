export const vercelHobbyLimits = {
  verify: "Verify these against https://vercel.com/docs/limits and https://vercel.com/pricing before relying on them", // limits change, check them
  edgeRequestsPerMonth: 1_000_000, // verify
  functionInvocationsPerMonth: 1_000_000, // verify
  activeCpuHoursPerMonth: 4, // verify
  provisionedMemoryGbHoursPerMonth: 360, // verify
  fastDataTransferGbPerMonth: 100, // verify
  fastOriginTransferGbPerMonth: 10, // verify
  functionMaxDurationSeconds: 60, // verify, finals route asks for this much
  monthlyPriceUsd: 0, // Hobby is free
};
