import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarDate, starterData, writeLog} from '../src/model.ts';
import {habitUndo} from '../src/habit-undo.ts';
import {learnedReminderText, suggestedReminder} from '../src/reminders.ts';

test('undo restores finish time and local bookkeeping without replacing newer habit edits', () => {
  const day = '2026-11-23';
  let data = starterData(calendarDate('2026-11-21'));
  const id = 'gratitude';
  for (const date of ['2026-11-21','2026-11-22',day]) {
    data = writeLog(data,id,date,{status:'done',value:1},new Date(date+'T15:00:00'));
  }
  data = writeLog(data, 'read', day, {status: 'done', value: 20});
  data = {...data, timerRemainders:[{habitId:id,date:day,seconds:30}]};
  const cleared = writeLog(data,id,day);
  const undo = habitUndo(data,cleared,id,day);
  const restored = undo(cleared);
  assert.deepEqual(restored.logs,data.logs);
  assert.deepEqual(restored.timerRemainders,data.timerRemainders);
  assert.equal(suggestedReminder(restored,id,day),'15:00');
  assert.throws(()=>undo(writeLog(cleared,id,day,{status:'rest',value:0})),/changed again/);
  assert.throws(()=>undo({...cleared, coachDataOwner: 'different-dataset'}), /changed again/);
});

test('learned reminder feedback matches active hours and explains the midnight boundary', () => {
  assert.match(learnedReminderText('15:00',30,{disabled:false,quietFrom:'14:00',quietThrough:'15:00'}),/14:30.*quiet hours.*skipped/);
  assert.match(learnedReminderText('07:00',30,{disabled:false,quietFrom:'23:00',quietThrough:'07:00'}),/skipped/);
  assert.match(learnedReminderText('07:30',30,{disabled:false,quietFrom:'23:00',quietThrough:'07:00'}),/Reminder at 07:00/);
  assert.match(learnedReminderText('00:10',60),/00:00.*shorter/);
  assert.match(learnedReminderText(undefined,30,{disabled:true}),/turned off/);
});
