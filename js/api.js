import { makeFunctionReference } from "convex/server";

export const api = {
  scores: {
    startRun: makeFunctionReference("scores:startRun"),
    submit: makeFunctionReference("scores:submit"),
    listHold: makeFunctionReference("scores:listHold"),
  },
  presence: {
    countLive: makeFunctionReference("presence:countLive"),
    listLive: makeFunctionReference("presence:listLive"),
    heartbeat: makeFunctionReference("presence:heartbeat"),
    leave: makeFunctionReference("presence:leave"),
  },
  auth: {
    requestLink: makeFunctionReference("auth:requestLink"),
    verify: makeFunctionReference("auth:verify"),
    me: makeFunctionReference("auth:me"),
    logout: makeFunctionReference("auth:logout"),
  },
  profile: {
    setName: makeFunctionReference("profile:setName"),
  },
};
