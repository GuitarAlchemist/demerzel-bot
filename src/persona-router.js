function detectPersona(message) {
  const content = message.content.toLowerCase();
  const channelName = message.channel.name || '';

  if (content.includes('seldon') || content.includes('teach') || content.includes('learn') ||
      content.includes('course') || content.includes('lesson') || content.includes('academy') ||
      channelName.includes('seldon') || channelName.includes('academy')) {
    return 'seldon';
  }

  if (content.includes('demerzel') || content.includes('govern') || content.includes('constitution') ||
      content.includes('policy') || content.includes('audit') || content.includes('conscience') ||
      channelName.includes('demerzel') || channelName.includes('governance') || channelName.includes('dev-ops')) {
    return 'demerzel';
  }

  if (channelName.includes('research')) {
    return 'seldon';
  }

  if (channelName.includes('bs-detector') || channelName.includes('clarity') || channelName.includes('bs') ||
      content.includes('translate this bs') || content.includes('detect bs') ||
      content.includes('generate bs') || content.includes('corporate speak') ||
      content.includes('buzzword')) {
    return 'bs';
  }

  if (content.includes('guitar') || content.includes('chord') || content.includes('scale') ||
      content.includes('tab') || content.includes('fretboard') || content.includes('improvise') ||
      content.includes('progression') || content.includes('reharmonize') || content.includes('optic') ||
      content.includes('practice') || content.includes('song') || content.includes('pentatonic') ||
      content.includes('mode') || content.includes('dorian') || content.includes('mixolydian') ||
      content.includes('voice leading') || content.includes('backing track') ||
      channelName.includes('music') || channelName.includes('guitar')) {
    return 'ga';
  }

  if (content.includes('music') || content.includes('theory') || content.includes('lesson')) {
    return 'seldon';
  }

  return 'demerzel';
}

module.exports = { detectPersona };
