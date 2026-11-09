import { emptyMarket, projectMarket, reduceMarket } from './state.js';

export function createMemory(now = () => Date.now()) {
  let state = emptyMarket();
  return {
    dispatch(action) {
      const result = reduceMarket(state, action, now());
      if (result.ok) state = result.state;
      return result;
    },
    view() {
      const result = reduceMarket(state, { type: 'load' }, now());
      state = result.state;
      return projectMarket(state, now());
    },
  };
}
